import {
  summarizeHistory,
  type BeachConfig,
  type HistoricalObservation,
  type HistoryProvenance,
  type HistorySummary,
} from '@seastate/shared';
import { DAY_MS, HOUR_MS } from '../lib/time';
import type { SourceContext } from '../sources/types';
import { synthesizeObservations } from './synthetic';

/**
 * Where hourly observations come from. Today that's the synthetic climatology. To use real history,
 * write a store that returns rows SeaState has recorded (for example, by appending each hour's
 * conditions to a file or database as the live sources are polled) and swap it in below. The
 * summaries, API, and UI stay the same.
 */
export interface ObservationStore {
  provenance: HistoryProvenance;
  observations(beach: BeachConfig, fromMs: number, toMs: number): Promise<HistoricalObservation[]>;
}

export const syntheticStore: ObservationStore = {
  provenance: 'synthetic',
  observations: async (beach, fromMs, toMs) => synthesizeObservations(beach, fromMs, toMs),
};

const store: ObservationStore = syntheticStore;

const HISTORY_DAYS = 365;
/** A year of history changes by an hour at a time; recomputing a few times a day is plenty. */
const HISTORY_TTL_MS = 6 * HOUR_MS;

/** GET /api/beaches/:beach/history: the past year, summarized. */
export async function loadHistory(ctx: SourceContext, beach: BeachConfig): Promise<HistorySummary> {
  const { value } = await ctx.cache.get(`history:${beach.id}`, HISTORY_TTL_MS, async () => {
    const to = ctx.now();
    const rows = await store.observations(beach, to - HISTORY_DAYS * DAY_MS, to);
    return summarizeHistory(beach, rows, store.provenance);
  });
  return value;
}
