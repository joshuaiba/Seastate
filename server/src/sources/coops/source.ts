import type { SeastateConfig, SourceResponse } from '@seastate/shared';
import { HOUR_MS, MINUTE_MS } from '../../lib/time';
import { settleProducts } from '../settle';
import type { SourceContext } from '../types';
import {
  fetchTideCurve,
  fetchTideExtremes,
  fetchWaterLevel,
  fetchWaterTemperature,
  fetchWind,
  type TimeRange,
} from './client';

/** GET /api/sources/coops: tide predictions and recent observations for the configured tide station. */
export async function loadCoops(ctx: SourceContext): Promise<SourceResponse<'coops'>> {
  const { config, mode, cache } = ctx;
  const station = config.stations.coops;
  const { tideDatum: datum, tideCurveIntervalMinutes: intervalMinutes, cacheMinutes } = config.data;
  const { tides, observed } = windows(config.data, ctx.now());
  const predictionsTtl = cacheMinutes.coopsPredictions * MINUTE_MS;
  const observationsTtl = cacheMinutes.coopsObservations * MINUTE_MS;
  const key = (product: string) => `coops:${station.id}:${product}`;

  const { values, warnings, fetchedAt } = await settleProducts({
    tideExtremes: cache.get(key('hilo'), predictionsTtl, () =>
      fetchTideExtremes(station.id, tides, { mode, datum }),
    ),
    tideCurve: cache.get(key('curve'), predictionsTtl, () =>
      fetchTideCurve(station.id, tides, { mode, datum, intervalMinutes }),
    ),
    waterLevel: cache.get(key('water_level'), observationsTtl, () =>
      fetchWaterLevel(station.id, observed, { mode, datum }),
    ),
    waterTemperature: cache.get(key('water_temperature'), observationsTtl, () =>
      fetchWaterTemperature(station.id, observed, { mode }),
    ),
    wind: cache.get(key('wind'), observationsTtl, () => fetchWind(station.id, observed, { mode })),
  });

  return { source: 'coops', station, mode, fetchedAt, warnings, data: { datum, ...values } };
}

/** Request windows around `now`: predictions on both sides of it, observations up to it. */
function windows(data: SeastateConfig['data'], now: number): { tides: TimeRange; observed: TimeRange } {
  return {
    tides: {
      begin: new Date(now - data.tidePastHours * HOUR_MS),
      end: new Date(now + data.tideFutureHours * HOUR_MS),
    },
    observed: { begin: new Date(now - data.historyHours * HOUR_MS), end: new Date(now) },
  };
}
