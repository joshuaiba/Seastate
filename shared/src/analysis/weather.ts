/*
 * WMO weather codes (what Open-Meteo reports) grouped into the handful of skies worth drawing.
 * https://open-meteo.com/en/docs#weathervariables
 */

export type Sky =
  | 'clear'
  | 'mostly-clear'
  | 'partly-cloudy'
  | 'overcast'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'showers'
  | 'thunder'
  | 'snow';

export interface WeatherDescription {
  sky: Sky;
  label: string;
}

/** Falls back to cloud cover when there's no code. */
export function describeWeather(code: number | null, cloudCoverPct: number | null = null): WeatherDescription {
  if (code === null) {
    if (cloudCoverPct === null) return { sky: 'partly-cloudy', label: '—' };
    return describeWeather(cloudCoverPct < 20 ? 0 : cloudCoverPct < 50 ? 1 : cloudCoverPct < 85 ? 2 : 3);
  }
  if (code === 0) return { sky: 'clear', label: 'Clear' };
  if (code === 1) return { sky: 'mostly-clear', label: 'Mostly clear' };
  if (code === 2) return { sky: 'partly-cloudy', label: 'Partly cloudy' };
  if (code === 3) return { sky: 'overcast', label: 'Overcast' };
  if (code === 45 || code === 48) return { sky: 'fog', label: 'Fog' };
  if (code >= 51 && code <= 57) return { sky: 'drizzle', label: 'Drizzle' };
  if (code >= 61 && code <= 67) return { sky: 'rain', label: code >= 65 ? 'Heavy rain' : 'Rain' };
  if (code >= 71 && code <= 77) return { sky: 'snow', label: 'Snow' };
  if (code >= 80 && code <= 82) return { sky: 'showers', label: 'Showers' };
  if (code >= 85 && code <= 86) return { sky: 'snow', label: 'Snow showers' };
  if (code >= 95) return { sky: 'thunder', label: 'Thunderstorms' };
  return { sky: 'partly-cloudy', label: 'Mixed' };
}

/** Wet weather codes: drizzle, rain, showers, thunder, snow. */
export function isWet(code: number | null): boolean {
  return code !== null && code >= 51;
}

/** UV index category names (WHO). */
export function uvLevel(uv: number): 'low' | 'moderate' | 'high' | 'very high' | 'extreme' {
  if (uv < 3) return 'low';
  if (uv < 6) return 'moderate';
  if (uv < 8) return 'high';
  if (uv < 11) return 'very high';
  return 'extreme';
}

/** Rough wetsuit guide for SoCal water, by °F. */
export function wetsuitFor(waterTempF: number): string {
  if (waterTempF >= 72) return 'Trunks or a rash guard';
  if (waterTempF >= 68) return 'Springsuit or 2 mm top';
  if (waterTempF >= 63) return '3/2 fullsuit';
  if (waterTempF >= 58) return '4/3 fullsuit';
  return '4/3 with booties';
}
