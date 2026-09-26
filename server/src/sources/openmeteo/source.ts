import type { BeachConfig, SourceResponse } from '@seastate/shared';
import { MINUTE_MS } from '../../lib/time';
import { settleProducts } from '../settle';
import type { SourceContext } from '../types';
import { fetchMarine, fetchWeather } from './client';

/** GET /api/beaches/:beach/sources/openmeteo: hourly weather and marine forecasts at the beach. */
export async function loadOpenMeteo(ctx: SourceContext, beach: BeachConfig): Promise<SourceResponse<'openmeteo'>> {
  const { config, mode, cache } = ctx;
  const ttl = config.data.cacheMinutes.openmeteo * MINUTE_MS;
  const options = { mode, forecastDays: config.data.forecastDays };
  const key = (product: string) => `openmeteo:${beach.id}:${product}`;

  const { values, warnings, fetchedAt } = await settleProducts({
    weather: cache.get(key('weather'), ttl, () => fetchWeather(beach, options)),
    marine: cache.get(key('marine'), ttl, () => fetchMarine(beach, options)),
  });

  return {
    source: 'openmeteo',
    beachId: beach.id,
    station: { id: `${beach.lat},${beach.lon}`, name: 'Open-Meteo forecast' },
    mode,
    fetchedAt,
    warnings,
    data: values,
  };
}
