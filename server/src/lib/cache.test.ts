import { describe, expect, it, vi } from 'vitest';
import { TtlCache } from './cache';

function setup() {
  let now = 0;
  const cache = new TtlCache({ now: () => now, retryAfterMs: 1_000 });
  return { cache, advance: (ms: number) => void (now += ms) };
}

describe('TtlCache', () => {
  it('serves a cached value until its TTL expires', async () => {
    const { cache, advance } = setup();
    const load = vi.fn<() => Promise<string>>().mockResolvedValueOnce('first').mockResolvedValueOnce('second');

    expect((await cache.get('k', 10_000, load)).value).toBe('first');
    advance(9_999);
    expect((await cache.get('k', 10_000, load)).value).toBe('first');
    advance(1);
    expect((await cache.get('k', 10_000, load)).value).toBe('second');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight load between concurrent requests', async () => {
    const { cache } = setup();
    const load = vi.fn(async () => 'value');

    const results = await Promise.all([cache.get('k', 1_000, load), cache.get('k', 1_000, load)]);

    expect(results.map((result) => result.value)).toEqual(['value', 'value']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('serves the previous value, marked stale, when a refresh fails', async () => {
    const { cache, advance } = setup();
    await cache.get('k', 1_000, async () => 'old');
    advance(1_000);

    const result = await cache.get('k', 1_000, async () => {
      throw new Error('NOAA is down');
    });

    expect(result).toMatchObject({ value: 'old', fetchedAt: 0, stale: true });
    expect((result.error as Error).message).toBe('NOAA is down');
  });

  it('remembers a failure for retryAfterMs instead of retrying on every request', async () => {
    const { cache, advance } = setup();
    const load = vi.fn(async (): Promise<string> => {
      throw new Error('No data was found');
    });

    await expect(cache.get('k', 60_000, load)).rejects.toThrow('No data was found');
    await expect(cache.get('k', 60_000, load)).rejects.toThrow('No data was found');
    expect(load).toHaveBeenCalledTimes(1);

    advance(1_000);
    await expect(cache.get('k', 60_000, load)).rejects.toThrow('No data was found');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('recovers when a loader throws synchronously', async () => {
    const { cache, advance } = setup();
    const load = (): Promise<string> => {
      throw new Error('boom');
    };

    await expect(cache.get('k', 1_000, load)).rejects.toThrow('boom');
    advance(1_000);
    await expect(cache.get('k', 1_000, async () => 'ok')).resolves.toMatchObject({ value: 'ok' });
  });
});
