import type { SurfProfile } from '../config';
import { metersToFeet, mpsToMph } from '../units';
import type { ConditionsSample, SwellComponent } from './conditions';
import { angleDiff, clamp, piecewise } from './math';

/*
 * Surf: offshore swell → breaking waves at a particular beach, and how good they are.
 *
 * These are forecaster's rules of thumb, not a wave model. Breaking ("face") height grows with swell
 * period, because long-period swell carries more energy for its height and stands up more in shallow
 * water. Each wave train is scaled by how open the beach is to its direction, and trains combine by
 * energy (root sum of squares), the way they do in the water.
 */

export interface SurfEstimate {
  /** Typical face height of the waves, ft. */
  faceFt: number;
  /** Surf-report range, e.g. 3–4 ft. `minFt` 0 and `maxFt` 0 mean flat. */
  minFt: number;
  maxFt: number;
  /** "3–4 ft", or "Flat". */
  label: string;
  /** Height against a standing surfer, e.g. "Waist to chest". */
  bodyRef: string;
  /** The train doing most of the work. */
  dominant: SwellComponent | null;
}

/** Face height per ft of swell, by period. Short wind chop barely registers at the beach. */
const PERIOD_FACTOR: [number, number][] = [
  [3, 0.3],
  [5, 0.6],
  [8, 1.0],
  [10, 1.2],
  [12, 1.38],
  [14, 1.55],
  [16, 1.68],
  [18, 1.78],
  [20, 1.85],
];

/** 0–1: how much of a swell from `dirDeg` reaches this beach. */
export function swellExposure(dirDeg: number, profile: SurfProfile): number {
  const { centerDeg, halfWidthDeg } = profile.swellWindow;
  const off = angleDiff(dirDeg, centerDeg);
  if (off >= halfWidthDeg) return 0;
  return profile.exposure * Math.cos(((off / halfWidthDeg) * Math.PI) / 2);
}

/** Face height one wave train produces at this beach, ft. */
export function trainFaceFt(train: SwellComponent, profile: SurfProfile): number {
  return metersToFeet(train.heightM) * piecewise(train.periodS, PERIOD_FACTOR) * swellExposure(train.dirDeg, profile);
}

export function estimateSurf(swells: readonly SwellComponent[], profile: SurfProfile): SurfEstimate {
  let energy = 0;
  let dominant: SwellComponent | null = null;
  let dominantFace = 0;
  for (const train of swells) {
    const face = trainFaceFt(train, profile);
    energy += face * face;
    if (face > dominantFace) {
      dominantFace = face;
      dominant = train;
    }
  }
  const faceFt = Math.sqrt(energy);
  const { minFt, maxFt, label } = surfRange(faceFt);
  return { faceFt, minFt, maxFt, label, bodyRef: bodyReference(faceFt), dominant };
}

/** Surf-report bins by typical face height: [up to this face height, low, high]. Bigger surf gets wider bins. */
const SURF_BINS: [number, number, number][] = [
  [1.2, 0, 1],
  [2.0, 1, 2],
  [2.8, 2, 3],
  [3.6, 3, 4],
  [4.4, 3, 5],
  [5.4, 4, 6],
  [6.6, 5, 7],
  [7.8, 6, 8],
  [9.5, 8, 10],
  [11.5, 10, 12],
  [14, 12, 15],
];

/** Rounds a face height to the ranges surf reports use: Flat, 0–1, 1–2, 2–3, 3–4, 3–5, 4–6… */
export function surfRange(faceFt: number): { minFt: number; maxFt: number; label: string } {
  if (faceFt < 0.6) return { minFt: 0, maxFt: 0, label: 'Flat' };
  const [, lo, hi] = SURF_BINS.find(([limit]) => faceFt < limit) ?? [Infinity, 15, 20];
  return { minFt: lo, maxFt: hi, label: `${lo}–${hi} ft` };
}

const BODY_REFERENCES: [number, string][] = [
  [0.6, 'Flat'],
  [1.3, 'Ankle to knee'],
  [2.1, 'Knee to thigh'],
  [2.9, 'Thigh to waist'],
  [3.7, 'Waist to chest'],
  [4.5, 'Chest to shoulder'],
  [5.5, 'Shoulder to head'],
  [6.7, 'Head high'],
  [8.5, 'Overhead'],
  [11.5, 'Well overhead'],
];

export function bodyReference(faceFt: number): string {
  return BODY_REFERENCES.find(([limit]) => faceFt < limit)?.[1] ?? 'Double overhead+';
}

export type WindRelation = 'calm' | 'offshore' | 'cross-offshore' | 'cross-shore' | 'cross-onshore' | 'onshore';

export interface WindQuality {
  relation: WindRelation;
  /** "Offshore", "Glassy"… */
  label: string;
  speedMph: number;
  /** 0–1 for surf: 1 is glassy or light offshore. */
  score: number;
}

const RELATION_LABELS: Record<WindRelation, string> = {
  calm: 'Glassy',
  offshore: 'Offshore',
  'cross-offshore': 'Cross-offshore',
  'cross-shore': 'Cross-shore',
  'cross-onshore': 'Cross-onshore',
  onshore: 'Onshore',
};

/** Wind score for surf by relation, against speed in mph. Offshore holds waves up; onshore crumbles them. */
const WIND_SCORE: Record<Exclude<WindRelation, 'calm'>, [number, number][]> = {
  offshore: [[15, 1], [25, 0.7], [35, 0.45]],
  'cross-offshore': [[6, 0.95], [12, 0.8], [20, 0.55], [30, 0.35]],
  'cross-shore': [[5, 0.85], [10, 0.6], [16, 0.35], [25, 0.2]],
  'cross-onshore': [[5, 0.75], [10, 0.45], [15, 0.28], [25, 0.12]],
  onshore: [[4, 0.72], [8, 0.45], [12, 0.28], [18, 0.12]],
};

/** Below this the sea is glassy whatever the direction. */
const CALM_MPH = 3;

export function windRelation(windFromDeg: number, speedMph: number, profile: SurfProfile): WindRelation {
  if (speedMph < CALM_MPH) return 'calm';
  // Offshore wind blows from the land: from the opposite of the way the beach faces.
  const off = angleDiff(windFromDeg, profile.facingDeg + 180);
  if (off <= 35) return 'offshore';
  if (off <= 70) return 'cross-offshore';
  if (off <= 110) return 'cross-shore';
  if (off <= 145) return 'cross-onshore';
  return 'onshore';
}

export function windQuality(speedMps: number, windFromDeg: number, profile: SurfProfile): WindQuality {
  const speedMph = mpsToMph(speedMps);
  const relation = windRelation(windFromDeg, speedMph, profile);
  const score = relation === 'calm' ? 1 : piecewise(speedMph, WIND_SCORE[relation]);
  return { relation, label: RELATION_LABELS[relation], speedMph, score };
}

export type SurfRating = 'flat' | 'poor' | 'poor-fair' | 'fair' | 'fair-good' | 'good' | 'epic';

/** Ratings from worst to best, with the score each starts at. */
export const SURF_RATINGS: readonly { id: SurfRating; label: string; minScore: number }[] = [
  { id: 'flat', label: 'Flat', minScore: 0 },
  { id: 'poor', label: 'Poor', minScore: 15 },
  { id: 'poor-fair', label: 'Poor to fair', minScore: 30 },
  { id: 'fair', label: 'Fair', minScore: 45 },
  { id: 'fair-good', label: 'Fair to good', minScore: 62 },
  { id: 'good', label: 'Good', minScore: 75 },
  { id: 'epic', label: 'Epic', minScore: 88 },
];

/** A score at or above this is a day worth planning around ("fair to good" or better). */
export const GOOD_SURF_SCORE = 62;

export function surfRating(score: number): (typeof SURF_RATINGS)[number] {
  return [...SURF_RATINGS].reverse().find((r) => score >= r.minScore) ?? SURF_RATINGS[0]!;
}

export type SurfFactor = 'size' | 'wind' | 'period' | 'tide';

export interface SurfScore {
  /** 0–100 */
  score: number;
  rating: SurfRating;
  surf: SurfEstimate;
  wind: WindQuality | null;
  /** Each factor, 0–1. */
  factors: Record<SurfFactor, number>;
  /** The factor holding the score back most, if any is. */
  limiting: SurfFactor | null;
}

const SIZE_SCORE: [number, number][] = [[0, 0], [1, 0.08], [2, 0.4], [3, 0.7], [4, 0.88], [6, 1], [9, 0.95], [12, 0.75]];
const PERIOD_SCORE: [number, number][] = [[5, 0.35], [8, 0.55], [11, 0.8], [14, 1]];

export function scoreSurf(sample: ConditionsSample, profile: SurfProfile): SurfScore {
  const surf = estimateSurf(sample.swells, profile);
  const wind =
    sample.windSpeedMps !== null && sample.windDirDeg !== null
      ? windQuality(sample.windSpeedMps, sample.windDirDeg, profile)
      : null;

  const period = surf.dominant ? piecewise(surf.dominant.periodS, PERIOD_SCORE) : 0.5;
  const factors: Record<SurfFactor, number> = {
    size: piecewise(surf.faceFt, SIZE_SCORE),
    wind: wind?.score ?? 0.75,
    period,
    tide: sample.tideM === null ? 1 : tideFit(sample.tideM, profile.idealTideM),
  };
  // A weighted geometric mean: flat surf can't be rescued by perfect wind, and size matters most.
  const score =
    100 * factors.size ** 0.6 * factors.wind ** 0.3 * factors.period ** 0.12 * factors.tide ** 0.1;

  return {
    score: clamp(score, 0, 100),
    rating: surfRating(score).id,
    surf,
    wind,
    factors,
    limiting: limitingFactor(factors, 0.8),
  };
}

/** 1 inside the ideal range, falling off outside it (never below 0.55: tide alone rarely ruins a session). */
export function tideFit(tideM: number, [low, high]: [number, number]): number {
  const outside = tideM < low ? low - tideM : tideM > high ? tideM - high : 0;
  return Math.max(0.55, 1 - outside * 0.7);
}

export function limitingFactor<F extends string>(factors: Record<F, number>, below: number): F | null {
  let worst: F | null = null;
  let worstValue = below;
  for (const [factor, value] of Object.entries(factors) as [F, number][]) {
    if (value < worstValue) {
      worst = factor;
      worstValue = value;
    }
  }
  return worst;
}
