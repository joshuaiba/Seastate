import {
  celsiusToFahrenheit,
  degreesToCompass,
  formatClock,
  metersToFeet,
  mpsToMph,
  zonedParts,
  type SurfRating,
} from '@seastate/shared';

// Display formatting. The data is SI and UTC; the page shows ft, °F, and mph in the beach's local time.

export const fmtFt = (m: number | null | undefined, digits = 1) =>
  m == null ? '—' : `${metersToFeet(m).toFixed(digits)} ft`;

export const toF = (c: number | null | undefined): number | null => (c == null ? null : celsiusToFahrenheit(c));

export const fmtF = (c: number | null | undefined) => (c == null ? '—' : `${Math.round(celsiusToFahrenheit(c))}°`);

export const toMph = (mps: number | null | undefined): number | null => (mps == null ? null : mpsToMph(mps));

export const fmtMph = (mps: number | null | undefined) => (mps == null ? '—' : `${Math.round(mpsToMph(mps))} mph`);

export const compass = (deg: number | null | undefined) => (deg == null ? '—' : degreesToCompass(deg));

export const clock = (ms: number, tz: string) => formatClock(ms, tz);

/** "6a", "12p", "3p": compact hour ticks for timelines. */
export function hourTick(ms: number, tz: string): string {
  const { hour } = zonedParts(ms, tz);
  if (hour === 0) return '12a';
  if (hour === 12) return '12p';
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
}

const weekdayFormatters = new Map<string, Intl.DateTimeFormat>();

/** "Today", "Tomorrow", or "Mon". */
export function dayLabel(ms: number, tz: string, dayOffset: number, style: 'short' | 'long' = 'short'): string {
  if (dayOffset === 0) return 'Today';
  if (dayOffset === 1) return 'Tomorrow';
  const key = `${tz}|${style}`;
  let f = weekdayFormatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: style });
    weekdayFormatters.set(key, f);
  }
  return f.format(ms);
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

export function shortDate(ms: number, tz: string): string {
  let f = dateFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric' });
    dateFormatters.set(tz, f);
  }
  return f.format(ms);
}

/** "just now", "12 min ago", "3 hr ago". */
export function ago(ms: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - ms) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} hr ago` : `${Math.round(hours / 24)} days ago`;
}

/** "in 2h 14m", "in 40m". */
export function countdown(ms: number, now: number): string {
  const minutes = Math.max(0, Math.round((ms - now) / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `in ${h}h ${String(m).padStart(2, '0')}m` : `in ${m}m`;
}

/** Index 0–6 into the quality ramp (--q0…--q6) for a 0–100 score. */
export function qualityStep(score: number): number {
  if (score >= 88) return 6;
  if (score >= 75) return 5;
  if (score >= 62) return 4;
  if (score >= 45) return 3;
  if (score >= 30) return 2;
  if (score >= 15) return 1;
  return 0;
}

export const qualityColor = (score: number) => `var(--q${qualityStep(score)})`;

const RATING_STEP: Record<SurfRating, number> = {
  flat: 0,
  poor: 1,
  'poor-fair': 2,
  fair: 3,
  'fair-good': 4,
  good: 5,
  epic: 6,
};

export const ratingColor = (rating: SurfRating) => `var(--q${RATING_STEP[rating]})`;
