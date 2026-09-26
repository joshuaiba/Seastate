/**
 * In-memory TTL cache for upstream NOAA responses. One per server process; nothing is persisted.
 *
 * - A value is served from memory until its TTL expires.
 * - Concurrent requests for the same key share one upstream fetch, so a burst of page loads becomes a
 *   single request to NOAA.
 * - If a refresh fails and an older value exists, the older value is served and marked stale.
 * - Failures are cached briefly too (retryAfterMs), so a product a station doesn't offer isn't
 *   re-requested on every page load.
 */

export interface CacheResult<T> {
  value: T;
  /** Epoch ms when `value` was fetched. */
  fetchedAt: number;
  /** True if the latest refresh failed and `value` is left over from an earlier fetch. */
  stale: boolean;
  /** Why the latest refresh failed, when `stale` is true. */
  error?: unknown;
}

interface Entry {
  /** The last successful fetch, if any. */
  value?: { data: unknown; fetchedAt: number };
  /** Set when the latest refresh failed. */
  failure?: { error: unknown };
  /** Epoch ms after which the next request triggers a refresh. */
  expiresAt: number;
}

export class TtlCache {
  private readonly entries = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<CacheResult<unknown>>>();
  private readonly now: () => number;
  private readonly retryAfterMs: number;

  constructor(options: { now?: () => number; retryAfterMs?: number } = {}) {
    this.now = options.now ?? Date.now;
    this.retryAfterMs = options.retryAfterMs ?? 60_000;
  }

  /** Returns the value cached under `key`, calling `load` if there is none or it's older than `ttlMs`. */
  async get<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<CacheResult<T>> {
    const entry = this.entries.get(key);
    if (entry && this.now() < entry.expiresAt) return toResult<T>(entry);

    let pending = this.inflight.get(key);
    if (!pending) {
      pending = this.refresh(key, ttlMs, load, entry);
      this.inflight.set(key, pending);
      const clear = () => this.inflight.delete(key);
      pending.then(clear, clear);
    }
    return pending as Promise<CacheResult<T>>;
  }

  private async refresh<T>(
    key: string,
    ttlMs: number,
    load: () => Promise<T>,
    previous: Entry | undefined,
  ): Promise<CacheResult<T>> {
    try {
      const data = await load();
      const fetchedAt = this.now();
      this.entries.set(key, { value: { data, fetchedAt }, expiresAt: fetchedAt + ttlMs });
      return { value: data, fetchedAt, stale: false };
    } catch (error) {
      const entry: Entry = {
        value: previous?.value,
        failure: { error },
        expiresAt: this.now() + Math.min(ttlMs, this.retryAfterMs),
      };
      this.entries.set(key, entry);
      return toResult<T>(entry);
    }
  }
}

/** The entry's value (stale if its last refresh failed), or its failure if it has never had a value. */
function toResult<T>(entry: Entry): CacheResult<T> {
  if (!entry.value) throw entry.failure?.error;
  const { data, fetchedAt } = entry.value;
  return entry.failure
    ? { value: data as T, fetchedAt, stale: true, error: entry.failure.error }
    : { value: data as T, fetchedAt, stale: false };
}
