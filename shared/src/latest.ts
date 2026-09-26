import type { IsoTime, Reading } from './common';

/**
 * The most recent non-null value of each field in a row type, with the time it was observed.
 * A field is absent if no row had a value for it, e.g. wind on a buoy with no anemometer.
 */
export type LatestReadings<T extends { time: IsoTime }> = {
  [K in Exclude<keyof T, 'time'>]?: Reading<NonNullable<T[K]>>;
};

/**
 * Collapses a time series into the latest value of each field. Readings are sparse: a buoy may log
 * wind every 10 minutes but waves every 30, so the newest row by itself often has gaps.
 * Rows can be in any order.
 */
export function latestReadings<T extends { time: IsoTime }>(rows: readonly T[]): LatestReadings<T> {
  const latest: Record<string, Reading<unknown>> = {};
  for (const row of rows) {
    for (const [field, value] of Object.entries(row)) {
      if (field === 'time' || value === null || value === undefined) continue;
      const current = latest[field];
      // ISO timestamps in the same format sort chronologically as strings.
      if (!current || row.time > current.time) latest[field] = { value, time: row.time };
    }
  }
  return latest as LatestReadings<T>;
}
