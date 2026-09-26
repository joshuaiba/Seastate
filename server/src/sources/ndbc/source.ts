import { latestReadings, type BeachConfig, type SourceResponse } from '@seastate/shared';
import { HOUR_MS, MINUTE_MS, since } from '../../lib/time';
import { settleProducts } from '../settle';
import type { SourceContext } from '../types';
import { fetchStandardMet, fetchWaveSummary } from './client';

/** GET /api/beaches/:beach/sources/ndbc: recent observations and wave summaries for the beach's buoy. */
export async function loadNdbc(ctx: SourceContext, beach: BeachConfig): Promise<SourceResponse<'ndbc'>> {
  const { config, mode, cache } = ctx;
  const station = beach.stations.ndbc;
  const ttl = config.data.cacheMinutes.ndbc * MINUTE_MS;

  // The cache holds each parsed 45-day file; the recent window is cut per request.
  const { values, warnings, fetchedAt } = await settleProducts({
    observations: cache.get(`ndbc:${station.id}:txt`, ttl, () => fetchStandardMet(station.id, { mode })),
    waveSummary: cache.get(`ndbc:${station.id}:spec`, ttl, () => fetchWaveSummary(station.id, { mode })),
  });

  const cutoff = ctx.now() - config.data.historyHours * HOUR_MS;
  return {
    source: 'ndbc',
    beachId: beach.id,
    station,
    mode,
    fetchedAt,
    warnings,
    data: {
      // From the full file, so a sensor that has gone quiet still shows its last value and time.
      latest: values.observations && latestReadings(values.observations),
      observations: values.observations && since(values.observations, cutoff),
      waveSummary: values.waveSummary && since(values.waveSummary, cutoff),
    },
  };
}
