/**
 * Captures live NOAA responses for the stations in seastate.config.ts into server/fixtures/, for
 * offline development (`npm run dev:offline`). Re-run it after changing stations.
 *
 * It runs the real source loaders with a recorder attached, so the fixtures are exactly the requests
 * the app makes, and a newly added source gets captured without any change here.
 */
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../seastate.config';
import { TtlCache } from '../src/lib/cache';
import { errorMessage } from '../src/lib/errors';
import { MANIFEST_FILE, type FixtureManifest } from '../src/lib/fixtures';
import { HOUR_MS } from '../src/lib/time';
import { recordUpstreamResponses } from '../src/lib/upstream';
import { FIXTURES_DIR } from '../src/paths';
import { sources } from '../src/sources';
import type { SourceContext } from '../src/sources/types';

// NDBC files hold 45 days. Keep enough to cover the history window, plus a margin.
const NDBC_KEEP_HOURS = config.data.historyHours + 48;

const capturedAt = Date.now();
const staging = `${FIXTURES_DIR}.partial`;

await rm(staging, { recursive: true, force: true });
recordUpstreamResponses(async (upstream, body) => {
  const file = path.join(staging, upstream.fixture);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, upstream.fixture.startsWith('ndbc/') ? trimNdbc(body) : body);
});

const ctx: SourceContext = { config, mode: 'live', cache: new TtlCache(), now: () => capturedAt };

try {
  for (const [id, load] of Object.entries(sources)) {
    const { warnings } = await load(ctx);
    console.log(`✓ ${id}${warnings.length > 0 ? ` (${warnings.length} warning${warnings.length > 1 ? 's' : ''})` : ''}`);
    for (const warning of warnings) console.log(`    ${warning}`);
  }
} catch (error) {
  await rm(staging, { recursive: true, force: true });
  console.error(`Capture failed; existing fixtures were left unchanged. ${errorMessage(error)}`);
  process.exit(1);
}

const manifest: FixtureManifest = {
  capturedAt: new Date(capturedAt).toISOString(),
  stations: { ndbc: config.stations.ndbc.id, coops: config.stations.coops.id },
};
await writeFile(path.join(staging, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
await rm(FIXTURES_DIR, { recursive: true, force: true });
await rename(staging, FIXTURES_DIR);
console.log(`Saved fixtures to server/fixtures/ (captured ${manifest.capturedAt})`);

/** Keeps an NDBC file's header lines and its most recent rows. */
function trimNdbc(text: string): string {
  const cutoff = capturedAt - NDBC_KEEP_HOURS * HOUR_MS;
  const kept = text.split('\n').filter((line) => line.startsWith('#') || rowTime(line) >= cutoff);
  return `${kept.join('\n')}\n`;
}

/** Epoch ms of an NDBC data line, whose first five cells are year, month, day, hour, minute (NaN if not a data line). */
function rowTime(line: string): number {
  const [year = NaN, month = NaN, day = NaN, hour = NaN, minute = NaN] = line.trim().split(/\s+/, 5).map(Number);
  return Date.UTC(year, month - 1, day, hour, minute);
}
