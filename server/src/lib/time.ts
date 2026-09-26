import type { IsoTime } from '@seastate/shared';

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** Rows observed at or after `cutoffMs` (epoch ms). */
export function since<T extends { time: IsoTime }>(rows: readonly T[], cutoffMs: number): T[] {
  return rows.filter((row) => Date.parse(row.time) >= cutoffMs);
}
