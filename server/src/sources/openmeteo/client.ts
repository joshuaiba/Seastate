import type { BeachConfig, DataMode, MarineHour, WeatherHour } from '@seastate/shared';
import { loadRows, type Upstream } from '../../lib/upstream';
import { MARINE_VARIABLES, parseMarine, parseWeather, WEATHER_VARIABLES } from './parser';

/*
 * Open-Meteo client: hourly weather and marine (swell) forecasts for a beach's coordinates.
 * Free for non-commercial use with no API key, within fair-use limits (about 10,000 calls a day). With
 * the server cache, three beaches use a few hundred a day.
 */

const WEATHER_API = 'https://api.open-meteo.com/v1/forecast';
const MARINE_API = 'https://marine-api.open-meteo.com/v1/marine';

export interface ForecastOptions {
  /** "fixture" reads server/fixtures/openmeteo/ instead of calling Open-Meteo. Default "live". */
  mode?: DataMode;
  /** Days of forecast, counting today. */
  forecastDays: number;
}

/** Hourly weather from a day ago through `forecastDays`. */
export function fetchWeather(beach: BeachConfig, { mode = 'live', forecastDays }: ForecastOptions): Promise<WeatherHour[]> {
  const upstream = request(WEATHER_API, beach, Object.values(WEATHER_VARIABLES), forecastDays, 'weather', {
    wind_speed_unit: 'ms',
  });
  return loadRows(upstream, mode, parseWeather);
}

/** Hourly swell, wind waves, and sea temperature from a day ago through `forecastDays`. */
export function fetchMarine(beach: BeachConfig, { mode = 'live', forecastDays }: ForecastOptions): Promise<MarineHour[]> {
  const upstream = request(MARINE_API, beach, Object.values(MARINE_VARIABLES), forecastDays, 'marine');
  return loadRows(upstream, mode, parseMarine);
}

/** Times are always unix seconds in GMT, and units metric; the parser relies on both. */
function request(
  base: string,
  beach: BeachConfig,
  variables: string[],
  forecastDays: number,
  fixtureName: string,
  params: Record<string, string> = {},
): Upstream {
  const query = new URLSearchParams({
    ...params,
    latitude: String(beach.lat),
    longitude: String(beach.lon),
    hourly: variables.join(','),
    timeformat: 'unixtime',
    timezone: 'GMT',
    past_days: '1',
    forecast_days: String(forecastDays),
  });
  return { url: `${base}?${query}`, fixture: `openmeteo/${beach.id}/${fixtureName}.json`, fixtureShift: 'days' };
}
