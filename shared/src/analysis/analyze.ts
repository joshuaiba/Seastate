import type { BeachConfig } from '../config';
import type { TideExtreme } from '../coops';
import { sunTimes, type SunTimes } from '../sun';
import { addLocalDays, HOUR_MS, localDayKey, localHour, MINUTE_MS, startOfLocalDay } from '../zoned';
import { scoreActivities, type Activity, type ActivityScores } from './activities';
import { sampleAt, type BeachConditions, type ConditionsSample } from './conditions';
import { mean, mod } from './math';
import { beachSummary, runSummary, surfSummary, verdict, type Summary, type Verdict } from './narrative';
import { surfRange, surfRating, windQuality, type SurfRating, type WindQuality } from './surf';
import { tideTrend, type TideTrend } from './tide';
import { isWet } from './weather';
import { bestWindow, type BestWindowOptions, type TimeWindow } from './windows';

/*
 * The analysis behind every view: conditions sampled every 15 minutes from local midnight today
 * through the end of the forecast, each point scored for surf, running, and hanging out. Daily
 * outlooks, best windows, and the written summaries are all derived from those points, so the page
 * never shows two answers to the same question.
 */

export const STEP_MS = 15 * MINUTE_MS;

export interface ForecastPoint {
  ms: number;
  sample: ConditionsSample;
  scores: ActivityScores;
}

export interface WindSummary {
  speedMps: number;
  dirDeg: number;
  quality: WindQuality;
}

export interface DayOutlook {
  /** Local date, "2026-09-26". */
  key: string;
  /** 0 = today. */
  dayOffset: number;
  startMs: number;
  endMs: number;
  sun: SunTimes;
  airHighC: number | null;
  airLowC: number | null;
  /** Representative daytime weather (WMO code). */
  weatherCode: number | null;
  cloudCoverMeanPct: number | null;
  precipChanceMaxPct: number | null;
  uvMax: number | null;
  waterTempC: number | null;
  surf: { minFt: number; maxFt: number; label: string; peakScore: number; rating: SurfRating };
  windAm: WindSummary | null;
  windPm: WindSummary | null;
  tides: TideExtreme[];
  /** Each activity's best window in daylight. */
  windows: Record<Activity, TimeWindow | null>;
  /** Each activity's best score in daylight. */
  peak: Record<Activity, number>;
  /** The day's points, for per-day charts. */
  points: ForecastPoint[];
}

export interface WindowInsight {
  activity: Activity;
  window: TimeWindow;
  /** 0 = today. */
  dayOffset: number;
  /** True if the window is happening now. */
  active: boolean;
  /** Conditions at the window's peak. */
  peak: ForecastPoint;
  /** Which way the tide is going at the start of the window. */
  tideTrend: TideTrend | null;
}

export interface BeachAnalysis {
  beach: BeachConfig;
  conditions: BeachConditions;
  /** Current conditions, scored. */
  now: ForecastPoint;
  points: ForecastPoint[];
  days: DayOutlook[];
  /** The next good window for each activity: later today, or tomorrow. */
  upcoming: Record<Activity, WindowInsight | null>;
  summaries: Record<Activity, Summary>;
  verdict: Verdict;
}

/** Part of the day each activity makes sense in, and how picky its windows are. */
const ACTIVITY_WINDOWS: Record<
  Activity,
  { from: (sun: SunTimes) => number; to: (sun: SunTimes) => number } & Omit<BestWindowOptions, 'stepMs'>
> = {
  // Dawn patrol counts: surfers are out at first light.
  surf: {
    from: (s) => s.dawn,
    to: (s) => s.sunset + 15 * MINUTE_MS,
    floor: 45,
    tolerance: 10,
    minDurationMs: HOUR_MS,
    maxDurationMs: 4 * HOUR_MS,
  },
  run: {
    from: (s) => s.dawn,
    to: (s) => s.dusk,
    floor: 65,
    tolerance: 12,
    minDurationMs: HOUR_MS,
    maxDurationMs: 3 * HOUR_MS,
  },
  beach: {
    from: (s) => s.sunrise + HOUR_MS,
    to: (s) => s.sunset - 30 * MINUTE_MS,
    floor: 60,
    tolerance: 12,
    minDurationMs: 90 * MINUTE_MS,
    maxDurationMs: 5 * HOUR_MS,
  },
};

export function analyzeBeach(conditions: BeachConditions): BeachAnalysis {
  const { beach, now } = conditions;
  const tz = beach.timezone;
  const nowPoint: ForecastPoint = {
    ms: now,
    sample: conditions.current,
    scores: scoreActivities(conditions.current, beach),
  };

  const lastHour = conditions.hourly.at(-1)?.ms ?? now;
  const points: ForecastPoint[] = [];
  for (let ms = startOfLocalDay(now, tz); ms <= lastHour; ms += STEP_MS) {
    const sample = sampleAt(conditions, ms);
    points.push({ ms, sample, scores: scoreActivities(sample, beach) });
  }

  const days: DayOutlook[] = [];
  for (let offset = 0; offset < 8; offset++) {
    const startMs = addLocalDays(now, offset, tz);
    const endMs = addLocalDays(now, offset + 1, tz);
    const dayPoints = points.filter((p) => p.ms >= startMs && p.ms < endMs);
    // A day needs most of its hours covered to be worth showing.
    if (dayPoints.length < 18 * 4) break;
    days.push(outlookForDay(conditions, dayPoints, offset, startMs, endMs));
  }

  const upcoming = {
    surf: upcomingWindow('surf', points, days, now),
    run: upcomingWindow('run', points, days, now),
    beach: upcomingWindow('beach', points, days, now),
  };

  const partial = { beach, conditions, now: nowPoint, points, days, upcoming };
  return {
    ...partial,
    summaries: { surf: surfSummary(partial), run: runSummary(partial), beach: beachSummary(partial) },
    verdict: verdict(partial),
  };
}

/** What narrative.ts and compare.ts work from. */
export type AnalysisCore = Pick<BeachAnalysis, 'beach' | 'conditions' | 'now' | 'points' | 'days' | 'upcoming'>;

function outlookForDay(
  conditions: BeachConditions,
  points: ForecastPoint[],
  dayOffset: number,
  startMs: number,
  endMs: number,
): DayOutlook {
  const { beach } = conditions;
  const tz = beach.timezone;
  const sun = sunTimes(startMs + 12 * HOUR_MS, beach.lat, beach.lon, tz);
  const inRange = (from: number, to: number) => points.filter((p) => p.ms >= from && p.ms <= to);
  const daylight = inRange(sun.sunrise, sun.sunset);
  const values = (list: ForecastPoint[], get: (s: ConditionsSample) => number | null) =>
    list.flatMap((p) => {
      const v = get(p.sample);
      return v === null ? [] : [v];
    });

  const temps = values(points, (s) => s.airTempC);
  const surfPoints = inRange(sun.dawn, sun.sunset);
  const faces = surfPoints.map((p) => p.scores.surf.surf.faceFt).sort((a, b) => a - b);
  const low = surfRange(faces[Math.floor(faces.length * 0.1)] ?? 0);
  const high = surfRange(faces[Math.floor(faces.length * 0.9)] ?? 0);
  const surfPeak = Math.max(0, ...surfPoints.map((p) => p.scores.surf.score));
  const minFt = low.maxFt === 0 ? 0 : low.minFt;
  const maxFt = high.maxFt;

  const windows = {} as Record<Activity, TimeWindow | null>;
  const peak = {} as Record<Activity, number>;
  for (const activity of ['surf', 'run', 'beach'] as const) {
    const spec = ACTIVITY_WINDOWS[activity];
    const scored = inRange(spec.from(sun), spec.to(sun)).map((p) => ({ ms: p.ms, score: p.scores[activity].score }));
    windows[activity] = bestWindow(scored, { ...spec, stepMs: STEP_MS });
    peak[activity] = Math.max(0, ...scored.map((p) => p.score));
  }

  const hourIn = (p: ForecastPoint, from: number, to: number) => {
    const h = localHour(p.ms, tz);
    return h >= from && h < to;
  };

  return {
    key: localDayKey(startMs, tz),
    dayOffset,
    startMs,
    endMs,
    sun,
    airHighC: temps.length ? Math.max(...temps) : null,
    airLowC: temps.length ? Math.min(...temps) : null,
    weatherCode: representativeWeather(points.filter((p) => hourIn(p, 8, 18))),
    cloudCoverMeanPct: mean(values(daylight, (s) => s.cloudCoverPct)),
    precipChanceMaxPct: maxOf(values(points, (s) => s.precipProbabilityPct)),
    uvMax: maxOf(values(points, (s) => s.uvIndex)),
    waterTempC: mean(values(daylight, (s) => s.waterTempC)),
    surf: {
      minFt,
      maxFt,
      label: maxFt === 0 ? 'Flat' : minFt === maxFt ? `${maxFt} ft` : `${minFt}–${maxFt} ft`,
      peakScore: surfPeak,
      rating: surfRating(surfPeak).id,
    },
    windAm: windSummary(points.filter((p) => hourIn(p, 6, 11)), beach),
    windPm: windSummary(points.filter((p) => hourIn(p, 12, 17)), beach),
    tides: conditions.tide.extremes
      .filter((e) => e.ms >= startMs && e.ms < endMs)
      .map(({ time, heightM, type }) => ({ time, heightM, type })),
    windows,
    peak,
    points,
  };
}

function upcomingWindow(
  activity: Activity,
  points: ForecastPoint[],
  days: DayOutlook[],
  now: number,
): WindowInsight | null {
  const spec = ACTIVITY_WINDOWS[activity];
  const insight = (window: TimeWindow, dayOffset: number): WindowInsight => {
    const peak = points.find((p) => p.ms === window.peakMs) ?? points[0]!;
    const start = points.find((p) => p.ms >= window.startMs);
    const rate = start?.sample.tideRateMPerHour ?? null;
    return {
      activity,
      window,
      dayOffset,
      active: now >= window.startMs && now < window.endMs,
      peak,
      tideTrend: rate === null ? null : tideTrend(rate),
    };
  };

  const today = days[0];
  if (today) {
    // What's left of today, starting from the current 15 minutes.
    const from = Math.max(spec.from(today.sun), now - (now % STEP_MS));
    const scored = points
      .filter((p) => p.ms >= from && p.ms <= spec.to(today.sun))
      .map((p) => ({ ms: p.ms, score: p.scores[activity].score }));
    const window = bestWindow(scored, { ...spec, stepMs: STEP_MS });
    if (window && window.endMs - now >= 45 * MINUTE_MS) return insight(window, 0);
  }
  const tomorrow = days[1]?.windows[activity];
  return tomorrow ? insight(tomorrow, 1) : null;
}

function windSummary(points: ForecastPoint[], beach: BeachConfig): WindSummary | null {
  const speeds: number[] = [];
  let x = 0;
  let y = 0;
  for (const { sample } of points) {
    if (sample.windSpeedMps === null || sample.windDirDeg === null) continue;
    speeds.push(sample.windSpeedMps);
    // Average direction as vectors, weighted by speed, so a calm hour's direction doesn't count much.
    x += sample.windSpeedMps * Math.sin((sample.windDirDeg * Math.PI) / 180);
    y += sample.windSpeedMps * Math.cos((sample.windDirDeg * Math.PI) / 180);
  }
  const speed = mean(speeds);
  if (speed === null) return null;
  const dirDeg = mod((Math.atan2(x, y) * 180) / Math.PI, 360);
  return { speedMps: speed, dirDeg, quality: windQuality(speed, dirDeg, beach.surf) };
}

/** A wet code if it rains for a couple of hours, fog if it lingers, otherwise sky cover. */
function representativeWeather(points: ForecastPoint[]): number | null {
  const codes = points.flatMap((p) => (p.sample.weatherCode === null ? [] : [p.sample.weatherCode]));
  if (codes.length === 0) return null;
  const wet = codes.filter(isWet);
  if (wet.length >= 8) return mostCommon(wet);
  const fog = codes.filter((c) => c === 45 || c === 48);
  if (fog.length >= 12) return 45;
  const cloud = mean(points.flatMap((p) => (p.sample.cloudCoverPct === null ? [] : [p.sample.cloudCoverPct])));
  if (cloud === null) return mostCommon(codes);
  return cloud < 20 ? 0 : cloud < 45 ? 1 : cloud < 80 ? 2 : 3;
}

function mostCommon(values: number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
}

function maxOf(values: number[]): number | null {
  return values.length ? Math.max(...values) : null;
}
