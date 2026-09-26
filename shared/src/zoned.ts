/*
 * Wall-clock helpers for a beach's IANA timezone. The API is all UTC; these turn instants into local
 * days and hours ("today", sunrise, the daily outlook) without a date library. Intl does the DST work.
 */

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export interface ZonedParts {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday */
  weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

// formatToParts is slow enough to matter across a year of hourly history, so offsets are cached per
// 15-minute bucket. Every real zone changes offset on a 15-minute boundary.
const BUCKET_MS = 15 * MINUTE_MS;
const offsets = new Map<string, number>();

/** How far local wall-clock time is ahead of UTC at `ms`, in ms (negative in the Americas). */
export function zoneOffsetMs(ms: number, timeZone: string): number {
  const bucket = Math.floor(ms / BUCKET_MS) * BUCKET_MS;
  const key = `${timeZone}|${bucket}`;
  const cached = offsets.get(key);
  if (cached !== undefined) return cached;

  const parts: Record<string, string> = {};
  for (const part of formatter(timeZone).formatToParts(bucket)) parts[part.type] = part.value;
  const wallAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  const offset = wallAsUtc - bucket;
  if (offsets.size > 100_000) offsets.clear();
  offsets.set(key, offset);
  return offset;
}

export function zonedParts(ms: number, timeZone: string): ZonedParts {
  const local = new Date(ms + zoneOffsetMs(ms, timeZone));
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    weekday: local.getUTCDay(),
  };
}

/** The instant a local wall-clock time happens. Month is 1–12; out-of-range days roll over. */
export function zonedTime(timeZone: string, year: number, month: number, day: number, hour = 0, minute = 0): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const guess = wall - zoneOffsetMs(wall, timeZone);
  // Re-check the offset at the guess, which differs from the one at `wall` near a DST change.
  return wall - zoneOffsetMs(guess, timeZone);
}

/** Local midnight at the start of the day containing `ms`. */
export function startOfLocalDay(ms: number, timeZone: string): number {
  const { year, month, day } = zonedParts(ms, timeZone);
  return zonedTime(timeZone, year, month, day);
}

/** Local midnight `days` days after the start of the day containing `ms` (DST-safe). */
export function addLocalDays(ms: number, days: number, timeZone: string): number {
  const { year, month, day } = zonedParts(ms, timeZone);
  return zonedTime(timeZone, year, month, day + days);
}

/** Hours since local midnight, fractional: 6:30 AM → 6.5. */
export function localHour(ms: number, timeZone: string): number {
  const { hour, minute } = zonedParts(ms, timeZone);
  return hour + minute / 60;
}

const clockFormatters = new Map<string, Intl.DateTimeFormat>();

/** "6:30 AM", or "11 AM" on the hour. */
export function formatClock(ms: number, timeZone: string): string {
  let f = clockFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
    clockFormatters.set(timeZone, f);
  }
  return f.format(ms).replace(':00', '').replace(/ /g, ' ');
}

/** "6:30–9 AM", or "11 AM–2 PM" when the range crosses noon. */
export function formatClockRange(startMs: number, endMs: number, timeZone: string): string {
  const start = formatClock(startMs, timeZone);
  const end = formatClock(endMs, timeZone);
  const suffix = (s: string) => s.slice(-2);
  return suffix(start) === suffix(end) ? `${start.slice(0, -3)}–${end}` : `${start}–${end}`;
}

/** "2026-09-26" for the local day containing `ms`. Sorts chronologically. */
export function localDayKey(ms: number, timeZone: string): string {
  const { year, month, day } = zonedParts(ms, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
