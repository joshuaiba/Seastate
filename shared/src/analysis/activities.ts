import type { BeachConfig } from '../config';
import { celsiusToFahrenheit, mpsToMph } from '../units';
import type { ConditionsSample } from './conditions';
import { clamp, piecewise } from './math';
import { limitingFactor, scoreSurf, type SurfScore } from './surf';

/*
 * The three reasons to go to the beach, each scored 0–100 from the same conditions sample. Every score
 * is a product of 0–1 factors, so one bad factor (dark, heat, rain) sinks it, and the lowest factor is
 * kept as `limiting` so summaries can say *why* ("before temperatures rise").
 */

export type Activity = 'surf' | 'run' | 'beach';

export const ACTIVITIES: readonly Activity[] = ['surf', 'run', 'beach'];

export type ActivityFactor = 'heat' | 'cold' | 'uv' | 'wind' | 'rain' | 'dark' | 'clouds';

export interface ActivityScore {
  /** 0–100 */
  score: number;
  factors: Partial<Record<ActivityFactor, number>>;
  limiting: ActivityFactor | null;
}

export type Quality = 'poor' | 'fair' | 'good' | 'great';

export function quality(score: number): Quality {
  if (score >= 82) return 'great';
  if (score >= 65) return 'good';
  if (score >= 45) return 'fair';
  return 'poor';
}

export interface ActivityScores {
  surf: SurfScore;
  run: ActivityScore;
  beach: ActivityScore;
}

export function scoreActivities(sample: ConditionsSample, beach: BeachConfig): ActivityScores {
  return { surf: scoreSurf(sample, beach.surf), run: scoreRun(sample), beach: scoreBeach(sample) };
}

/** A run on the sand or the boardwalk: cool, not too sunny, not too windy, and light enough to see. */
export function scoreRun(sample: ConditionsSample): ActivityScore {
  const feelsF = fahrenheit(sample.feelsLikeC ?? sample.airTempC);
  const mph = sample.windSpeedMps === null ? 0 : mpsToMph(sample.windSpeedMps);
  const factors: Partial<Record<ActivityFactor, number>> = {
    heat: feelsF === null ? 1 : piecewise(feelsF, [[68, 1], [75, 0.85], [82, 0.6], [90, 0.3]]),
    cold: feelsF === null ? 1 : piecewise(feelsF, [[35, 0.5], [45, 0.85], [50, 1]]),
    uv: piecewise(sample.uvIndex ?? 0, [[5, 1], [7, 0.88], [10, 0.72]]),
    wind: piecewise(mph, [[10, 1], [15, 0.82], [22, 0.55], [30, 0.35]]),
    rain: rainFactor(sample),
    dark: piecewise(sample.sunElevationDeg, [[-8, 0.3], [-4, 0.75], [0, 1]]),
  };
  return finish(factors);
}

/** Hanging out: warm, sunny, calm, dry, and daytime. */
export function scoreBeach(sample: ConditionsSample): ActivityScore {
  const feelsF = fahrenheit(sample.feelsLikeC ?? sample.airTempC);
  const mph = sample.windSpeedMps === null ? 0 : mpsToMph(sample.windSpeedMps);
  const factors: Partial<Record<ActivityFactor, number>> = {
    cold: feelsF === null ? 1 : piecewise(feelsF, [[58, 0.25], [64, 0.5], [70, 0.8], [74, 1]]),
    heat: feelsF === null ? 1 : piecewise(feelsF, [[86, 1], [92, 0.78], [100, 0.5]]),
    clouds: piecewise(sample.cloudCoverPct ?? 0, [[30, 1], [60, 0.85], [90, 0.62], [100, 0.55]]),
    wind: piecewise(mph, [[8, 1], [12, 0.82], [18, 0.55], [25, 0.3]]),
    rain: rainFactor(sample),
    dark: piecewise(sample.sunElevationDeg, [[-2, 0.15], [4, 0.6], [12, 1]]),
  };
  return finish(factors);
}

function rainFactor(sample: ConditionsSample): number {
  const chance = piecewise(sample.precipProbabilityPct ?? 0, [[20, 1], [50, 0.72], [80, 0.45]]);
  const falling = piecewise(sample.precipitationMm ?? 0, [[0.1, 1], [1, 0.5], [4, 0.25]]);
  return Math.min(chance, falling);
}

function finish(factors: Partial<Record<ActivityFactor, number>>): ActivityScore {
  const values = Object.values(factors) as number[];
  const score = clamp(100 * values.reduce((product, v) => product * v, 1), 0, 100);
  return { score, factors, limiting: limitingFactor(factors as Record<ActivityFactor, number>, 0.9) };
}

function fahrenheit(c: number | null): number | null {
  return c === null ? null : celsiusToFahrenheit(c);
}
