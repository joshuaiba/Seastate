import type { IsoTime, MarineHour, WeatherHour } from '@seastate/shared';

/*
 * Open-Meteo responses
 * --------------------
 * Weather: GET https://api.open-meteo.com/v1/forecast        (https://open-meteo.com/en/docs)
 * Marine:  GET https://marine-api.open-meteo.com/v1/marine   (https://open-meteo.com/en/docs/marine-weather-api)
 *
 * Both return columns rather than rows: one array per variable, index-aligned with `hourly.time`.
 *
 *   { "latitude": 33.625, "longitude": -118.04, "utc_offset_seconds": 0,
 *     "hourly_units": { "time": "unixtime", "wave_height": "m", ... },
 *     "hourly": { "time": [1790380800, ...], "wave_height": [0.82, ...], ... } }
 *
 * - We always request timeformat=unixtime (seconds) and timezone=GMT, so times are unambiguous.
 * - A value the model doesn't have is null, e.g. secondary swell when there's only one train.
 * - The returned coordinates are the model grid cell used, which may be a few km from the one requested
 *   (the marine API picks the nearest sea cell).
 * - Errors are HTTP 400 with {"error": true, "reason": "..."}.
 */

/** Our field name → Open-Meteo's variable name. The client requests exactly these. */
export const WEATHER_VARIABLES = {
  airTempC: 'temperature_2m',
  feelsLikeC: 'apparent_temperature',
  humidityPct: 'relative_humidity_2m',
  precipProbabilityPct: 'precipitation_probability',
  precipitationMm: 'precipitation',
  cloudCoverPct: 'cloud_cover',
  weatherCode: 'weather_code',
  windSpeedMps: 'wind_speed_10m',
  windDirDeg: 'wind_direction_10m',
  windGustMps: 'wind_gusts_10m',
  uvIndex: 'uv_index',
} as const satisfies Record<Exclude<keyof WeatherHour, 'time'>, string>;

export const MARINE_VARIABLES = {
  waveHeightM: 'wave_height',
  waveDirDeg: 'wave_direction',
  wavePeriodS: 'wave_period',
  swellHeightM: 'swell_wave_height',
  swellDirDeg: 'swell_wave_direction',
  swellPeriodS: 'swell_wave_period',
  secondarySwellHeightM: 'secondary_swell_wave_height',
  secondarySwellDirDeg: 'secondary_swell_wave_direction',
  secondarySwellPeriodS: 'secondary_swell_wave_period',
  windWaveHeightM: 'wind_wave_height',
  windWaveDirDeg: 'wind_wave_direction',
  windWavePeriodS: 'wind_wave_period',
  seaSurfaceTempC: 'sea_surface_temperature',
} as const satisfies Record<Exclude<keyof MarineHour, 'time'>, string>;

export function parseWeather(body: string): WeatherHour[] {
  return parseHourly(body, WEATHER_VARIABLES);
}

export function parseMarine(body: string): MarineHour[] {
  return parseHourly(body, MARINE_VARIABLES);
}

type Row<F extends Record<string, string>> = { time: IsoTime } & { [K in keyof F]: number | null };

/** Turns Open-Meteo's column arrays into one row per hour. A variable missing from the response is null. */
export function parseHourly<F extends Record<string, string>>(body: string, variables: F): Row<F>[] {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error(`Open-Meteo returned something other than JSON: ${body.slice(0, 100)}`);
  }
  const response = json as { error?: boolean; reason?: string; hourly?: Record<string, unknown> } | null;
  if (!response || typeof response !== 'object') throw new Error('Open-Meteo returned an unexpected response');
  if (response.error) throw new Error(`Open-Meteo: ${response.reason ?? 'unknown error'}`);

  const hourly = response.hourly;
  const times = hourly?.time;
  if (!hourly || !Array.isArray(times)) throw new Error('Open-Meteo response has no "hourly.time" array');

  const columns = Object.entries(variables).map(([field, variable]) => {
    const values = hourly[variable];
    return [field, Array.isArray(values) ? values : []] as const;
  });

  return times.flatMap((seconds, index): Row<F>[] => {
    if (typeof seconds !== 'number') return [];
    const row: Record<string, unknown> = { time: new Date(seconds * 1000).toISOString() };
    for (const [field, values] of columns) {
      const value = values[index];
      row[field] = typeof value === 'number' && Number.isFinite(value) ? value : null;
    }
    return [row as Row<F>];
  });
}
