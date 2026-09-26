import { HOUR_MS } from '../zoned';
import { lerp, lerpAngle } from './math';

/** A row with its time as epoch ms, so lookups don't re-parse ISO strings. */
export interface Timed {
  ms: number;
}

/** Index of the last row at or before `ms`, or -1 if every row is later. Rows must be sorted. */
export function indexAtOrBefore(rows: readonly Timed[], ms: number): number {
  let lo = 0;
  let hi = rows.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid]!.ms <= ms) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * A field's value at `ms`, linearly interpolated between the nearest rows that have it. Null outside
 * the series or across a gap longer than `maxGapMs` (a missing stretch shouldn't be papered over).
 */
export function interpolate<T extends Timed>(
  rows: readonly T[],
  ms: number,
  get: (row: T) => number | null,
  { maxGapMs = 3 * HOUR_MS, angle = false }: { maxGapMs?: number; angle?: boolean } = {},
): number | null {
  const i = indexAtOrBefore(rows, ms);
  const before = findValue(rows, i, -1, get);
  const after = findValue(rows, i + 1, 1, get);
  if (before && before.row.ms === ms) return before.value;
  if (!before || !after) {
    // Just past the last reading (or before the first) still counts, within half a gap.
    const edge = before ?? after;
    return edge && Math.abs(edge.row.ms - ms) <= maxGapMs / 2 ? edge.value : null;
  }
  if (after.row.ms - before.row.ms > maxGapMs) return null;
  const t = (ms - before.row.ms) / (after.row.ms - before.row.ms);
  return angle ? lerpAngle(before.value, after.value, t) : lerp(before.value, after.value, t);
}

function findValue<T extends Timed>(
  rows: readonly T[],
  start: number,
  step: 1 | -1,
  get: (row: T) => number | null,
): { row: T; value: number } | null {
  // Look a few rows either way: sparse series (a buoy that skips a report) still interpolate.
  for (let i = start, n = 0; i >= 0 && i < rows.length && n < 6; i += step, n++) {
    const row = rows[i]!;
    const value = get(row);
    if (value !== null && Number.isFinite(value)) return { row, value };
  }
  return null;
}

export function withMs<T extends { time: string }>(rows: readonly T[] | null | undefined): (T & Timed)[] {
  return (rows ?? []).map((row) => ({ ...row, ms: Date.parse(row.time) }));
}
