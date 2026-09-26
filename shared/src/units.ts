// The API reports SI units (m, s, m/s, °C) and directions in degrees true. Convert for display here.

export const metersToFeet = (m: number): number => m / 0.3048;
export const celsiusToFahrenheit = (c: number): number => (c * 9) / 5 + 32;
export const mpsToKnots = (mps: number): number => (mps * 3600) / 1852;
export const mpsToMph = (mps: number): number => (mps * 3600) / 1609.344;

/** The 16 compass points, clockwise from north. */
export const COMPASS_POINTS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
] as const;

export type CompassPoint = (typeof COMPASS_POINTS)[number];

export function isCompassPoint(value: string): value is CompassPoint {
  return (COMPASS_POINTS as readonly string[]).includes(value);
}

/** Nearest compass point to a bearing, e.g. 280 → "W". */
export function degreesToCompass(degrees: number): CompassPoint {
  const index = Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16;
  return COMPASS_POINTS[index]!;
}

/** Bearing at the center of a compass point, e.g. "WSW" → 247.5. */
export function compassToDegrees(point: CompassPoint): number {
  return COMPASS_POINTS.indexOf(point) * 22.5;
}
