import type { IsoTime } from '@seastate/shared';
import type { CacheResult } from '../lib/cache';
import { UpstreamError, errorMessage } from '../lib/errors';

type Products = Record<string, Promise<CacheResult<unknown>>>;

export interface SettledProducts<P extends Products> {
  values: { [K in keyof P]: Awaited<P[K]>['value'] | null };
  warnings: string[];
  /** When the oldest of the products was fetched from upstream. */
  fetchedAt: IsoTime;
}

/**
 * Waits for a source's products (each a cached upstream request) in parallel. A product that fails
 * becomes null plus a warning, e.g. water temperature at a station with no temperature sensor, so one
 * missing product doesn't take down the whole response. Throws only if every product failed.
 */
export async function settleProducts<P extends Products>(products: P): Promise<SettledProducts<P>> {
  const names = Object.keys(products);
  const results = await Promise.allSettled(Object.values(products));
  const values: Record<string, unknown> = {};
  const warnings: string[] = [];
  let oldestFetch = Infinity;

  results.forEach((result, i) => {
    const name = names[i]!;
    if (result.status === 'rejected') {
      values[name] = null;
      warnings.push(`${name}: ${errorMessage(result.reason)}`);
      return;
    }
    const { value, fetchedAt, stale, error } = result.value;
    values[name] = value;
    oldestFetch = Math.min(oldestFetch, fetchedAt);
    if (stale) {
      const cachedAt = new Date(fetchedAt).toISOString();
      warnings.push(`${name}: refresh failed, serving data cached at ${cachedAt} (${errorMessage(error)})`);
    }
  });

  if (oldestFetch === Infinity) throw new UpstreamError(`Every upstream request failed. ${warnings.join(' ')}`);
  return {
    values: values as SettledProducts<P>['values'],
    warnings,
    fetchedAt: new Date(oldestFetch).toISOString(),
  };
}
