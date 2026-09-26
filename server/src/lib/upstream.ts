import type { DataMode, IsoTime } from '@seastate/shared';
import { env } from '../env';
import { UpstreamError, errorMessage } from './errors';
import { readFixture, retimeFixture } from './fixtures';
import { DAY_MS, HOUR_MS } from './time';

/** One upstream resource: its URL, and where its captured copy lives under server/fixtures. */
export interface Upstream {
  url: string;
  fixture: string;
  /** How fixture mode moves its timestamps to the present. Forecasts use "days" (see fixtures.ts). */
  fixtureShift?: 'hours' | 'days';
}

const TIMEOUT_MS = 15_000;

/**
 * Loads an upstream resource and parses it into timestamped rows.
 *   live     fetches `upstream.url`
 *   fixture  reads `upstream.fixture` and shifts its timestamps to the present (see fixtures.ts)
 * Both modes run the same parser, so offline mode exercises the real parsing code.
 */
export async function loadRows<T extends { time: IsoTime }>(
  upstream: Upstream,
  mode: DataMode,
  parse: (body: string) => T[],
): Promise<T[]> {
  if (mode === 'fixture') {
    const stepMs = upstream.fixtureShift === 'days' ? DAY_MS : HOUR_MS;
    return retimeFixture(parse(await readFixture(upstream.fixture)), Date.now(), stepMs);
  }
  const body = await fetchText(upstream.url);
  await recorder?.(upstream, body);
  return parse(body);
}

/** GETs a URL as text. Throws UpstreamError on a network error, a timeout, or a non-2xx status. */
export async function fetchText(url: string): Promise<string> {
  const started = performance.now();
  let response: Response;
  let body: string;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': env.userAgent },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    body = await response.text();
  } catch (error) {
    throw new UpstreamError(`Request failed (${describeFetchError(error)}): ${url}`, { url, cause: error });
  }
  console.log(`[upstream] ${response.status} ${url} (${Math.round(performance.now() - started)} ms)`);

  if (!response.ok) {
    // CO-OPS and Open-Meteo explain 4xx errors in a JSON body; NDBC sends an HTML error page.
    const detail = jsonErrorMessage(body);
    throw new UpstreamError(`${response.status} ${response.statusText}${detail ? ` (${detail})` : ''}: ${url}`, {
      url,
      status: response.status,
    });
  }
  return body;
}

function describeFetchError(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') return `timed out after ${TIMEOUT_MS / 1000}s`;
  // Node's fetch reports network failures as TypeError("fetch failed") with the real reason in `cause`.
  const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : '';
  return `${errorMessage(error)}${cause}`;
}

function jsonErrorMessage(body: string): string | undefined {
  try {
    // CO-OPS: {"error": {"message": "..."}}. Open-Meteo: {"error": true, "reason": "..."}.
    const json = JSON.parse(body) as { error?: { message?: unknown }; reason?: unknown } | null;
    const message = json?.error?.message ?? json?.reason;
    return typeof message === 'string' ? message.trim() : undefined;
  } catch {
    return undefined;
  }
}

type Recorder = (upstream: Upstream, body: string) => Promise<void>;
let recorder: Recorder | undefined;

/**
 * While set, every live response body passes through `record` before it's parsed. The fixture capture
 * script uses this to save exactly what the app requests. That includes CO-OPS error bodies, so
 * offline mode reproduces "not offered at this station" warnings too.
 */
export function recordUpstreamResponses(record: Recorder | undefined): void {
  recorder = record;
}
