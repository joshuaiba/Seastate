import type { BeachConfig, DataMode, SeastateConfig, SourceId, SourceResponse } from '@seastate/shared';
import type { TtlCache } from '../lib/cache';

/** What every source loader gets. One context is created at startup (see index.ts). */
export interface SourceContext {
  config: SeastateConfig;
  mode: DataMode;
  cache: TtlCache;
  /** Epoch ms. Injected so request windows can be computed against a fixed time (fixture capture, tests). */
  now: () => number;
}

/**
 * Loads one source's data for one beach's station. It should resolve with warnings when only some
 * products are unavailable (see settleProducts), and reject only when nothing could be loaded.
 * Cache keys are per station, not per beach, so beaches that share a station share one upstream fetch.
 */
export type SourceLoader<K extends SourceId> = (ctx: SourceContext, beach: BeachConfig) => Promise<SourceResponse<K>>;
