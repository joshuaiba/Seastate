import type { TideExtreme } from '../coops';
import { HOUR_MS, MINUTE_MS } from '../zoned';
import { indexAtOrBefore, interpolate, type Timed } from './timeseries';

export interface TideSeries {
  /** Predicted curve. Empty at subordinate stations, which only publish highs and lows. */
  curve: (Timed & { heightM: number })[];
  extremes: (Timed & TideExtreme)[];
}

export type TideTrend = 'rising' | 'falling' | 'slack';

/** Predicted tide height at `ms`, m. Uses the curve when there is one, else a cosine between highs and lows. */
export function tideHeightAt(tide: TideSeries, ms: number): number | null {
  if (tide.curve.length > 0) {
    const height = interpolate(tide.curve, ms, (p) => p.heightM, { maxGapMs: 2 * HOUR_MS });
    if (height !== null) return height;
  }
  const i = indexAtOrBefore(tide.extremes, ms);
  const prev = tide.extremes[i];
  const next = tide.extremes[i + 1];
  if (!prev || !next) return null;
  // Between a high and a low the tide follows half a cosine closely enough to plan around.
  const t = (ms - prev.ms) / (next.ms - prev.ms);
  return next.heightM + (prev.heightM - next.heightM) * (1 + Math.cos(Math.PI * t)) / 2;
}

/** Rate of change at `ms`, m per hour. Positive while the tide comes in. */
export function tideRateAt(tide: TideSeries, ms: number): number | null {
  const span = 15 * MINUTE_MS;
  const before = tideHeightAt(tide, ms - span);
  const after = tideHeightAt(tide, ms + span);
  return before === null || after === null ? null : ((after - before) / (2 * span)) * HOUR_MS;
}

/** Below about 3 cm an hour the water is effectively standing still at the turn of the tide. */
export function tideTrend(rateMPerHour: number): TideTrend {
  if (Math.abs(rateMPerHour) < 0.03) return 'slack';
  return rateMPerHour > 0 ? 'rising' : 'falling';
}

/** The first high and first low after `ms`, in time order. */
export function nextExtremes(tide: TideSeries, ms: number): (Timed & TideExtreme)[] {
  const upcoming = tide.extremes.filter((e) => e.ms > ms);
  const high = upcoming.find((e) => e.type === 'high');
  const low = upcoming.find((e) => e.type === 'low');
  return [high, low].filter((e): e is Timed & TideExtreme => e !== undefined).sort((a, b) => a.ms - b.ms);
}

/** The day's tide range for scaling visuals: lowest low and highest high within [fromMs, toMs]. */
export function tideRange(tide: TideSeries, fromMs: number, toMs: number): { lowM: number; highM: number } | null {
  const within = tide.extremes.filter((e) => e.ms >= fromMs && e.ms <= toMs);
  const source = within.length >= 2 ? within : tide.extremes;
  if (source.length === 0) return null;
  const heights = source.map((e) => e.heightM);
  return { lowM: Math.min(...heights), highM: Math.max(...heights) };
}
