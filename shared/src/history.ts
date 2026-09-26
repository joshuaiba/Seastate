import { quantile, mean } from './analysis/math';
import type { ConditionsSample, SwellComponent } from './analysis/conditions';
import { GOOD_SURF_SCORE, scoreSurf } from './analysis/surf';
import type { IsoTime } from './common';
import type { BeachConfig } from './config';
import { sunPosition } from './sun';
import { COMPASS_POINTS, degreesToCompass, metersToFeet, type CompassPoint } from './units';
import { localDayKey, zonedParts } from './zoned';

/*
 * History: what a beach has been like, summarized for the Insights section.
 *
 * The unit of history is an hourly observation record (below): one row per hour per beach, in the
 * same SI units as the live API. The summary is computed from those rows with the same scoring the
 * live page uses, so a "good surf day" means the same thing in both places. Today the rows come from
 * a synthetic climatology (server/src/history/synthetic.ts); swapping in recorded observations only
 * changes where the rows come from.
 */

/** One hour of conditions at a beach, as it would be recorded. */
export interface HistoricalObservation {
  time: IsoTime;
  swellHeightM: number | null;
  swellPeriodS: number | null;
  swellDirDeg: number | null;
  secondarySwellHeightM: number | null;
  secondarySwellPeriodS: number | null;
  secondarySwellDirDeg: number | null;
  windWaveHeightM: number | null;
  windWavePeriodS: number | null;
  windWaveDirDeg: number | null;
  windSpeedMps: number | null;
  windDirDeg: number | null;
  waterTempC: number | null;
  airTempC: number | null;
  tideM: number | null;
}

/** "synthetic": modeled from regional climatology. "recorded": real observations SeaState collected. */
export type HistoryProvenance = 'synthetic' | 'recorded';

export interface MonthStat {
  /** 0 = January */
  month: number;
  /** Daylight surf face height, ft. */
  surfFtMean: number | null;
  surfFtP25: number | null;
  surfFtP75: number | null;
  waterTempCMean: number | null;
  /** Days with at least two good hours of surf. */
  goodDays: number;
  days: number;
  windAmMpsMean: number | null;
  windPmMpsMean: number | null;
}

export interface DayStat {
  /** Local date, "2026-09-26". */
  date: string;
  /** Best daylight surf score, 0–100. */
  bestScore: number;
  surfFtMax: number;
  waterTempCMean: number | null;
  good: boolean;
}

export interface HourWindStat {
  /** Local hour, 0–23. */
  hour: number;
  speedMpsMean: number | null;
  /** Share of hours with glassy, offshore, or cross-offshore wind. */
  cleanShare: number;
  /** Share of hours with onshore or cross-onshore wind. */
  onshoreShare: number;
}

export interface DirectionBin {
  point: CompassPoint;
  dirDeg: number;
  /** Share of hours the primary swell came from this direction. */
  share: number;
  heightFtMean: number | null;
}

export type Season = 'winter' | 'spring' | 'summer' | 'fall';

export interface SeasonStat {
  season: Season;
  surfFtMean: number | null;
  waterTempCMean: number | null;
  goodDayShare: number;
  dominantSwell: CompassPoint | null;
}

/** Response of GET /api/beaches/:beach/history. */
export interface HistorySummary {
  beachId: string;
  provenance: HistoryProvenance;
  from: IsoTime;
  to: IsoTime;
  observationCount: number;
  /** Score a surf hour must reach to count as good. */
  goodScore: number;
  months: MonthStat[];
  /** One per local day, oldest first. */
  days: DayStat[];
  windByHour: HourWindStat[];
  /** Mean surf score by month (rows, Jan first) and local hour (columns); null outside daylight. */
  surfByMonthHour: (number | null)[][];
  swellRose: DirectionBin[];
  seasons: SeasonStat[];
}

const SEASON_OF_MONTH: Season[] = [
  'winter', 'winter', 'spring', 'spring', 'spring', 'summer',
  'summer', 'summer', 'fall', 'fall', 'fall', 'winter',
];

interface ScoredHour {
  ms: number;
  date: string;
  month: number;
  hour: number;
  daylight: boolean;
  faceFt: number;
  score: number;
  obs: HistoricalObservation;
  windClean: boolean;
  windOnshore: boolean;
}

export function summarizeHistory(
  beach: BeachConfig,
  observations: readonly HistoricalObservation[],
  provenance: HistoryProvenance,
): HistorySummary {
  const hours = observations.map((obs) => scoreHour(beach, obs));
  const byDay = groupBy(hours, (h) => h.date);

  const days: DayStat[] = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, list]) => {
      const daylight = list.filter((h) => h.daylight);
      return {
        date,
        bestScore: Math.max(0, ...daylight.map((h) => h.score)),
        surfFtMax: Math.max(0, ...daylight.map((h) => h.faceFt)),
        waterTempCMean: mean(numbers(list, (h) => h.obs.waterTempC)),
        good: daylight.filter((h) => h.score >= GOOD_SURF_SCORE).length >= 2,
      };
    });
  const monthOfDay = (d: DayStat) => Number(d.date.slice(5, 7)) - 1;

  const months: MonthStat[] = Array.from({ length: 12 }, (_, month) => {
    const list = hours.filter((h) => h.month === month);
    const surf = list.filter((h) => h.daylight).map((h) => h.faceFt).sort((a, b) => a - b);
    const monthDays = days.filter((d) => monthOfDay(d) === month);
    const wind = (from: number, to: number) =>
      mean(numbers(list.filter((h) => h.hour >= from && h.hour < to), (h) => h.obs.windSpeedMps));
    return {
      month,
      surfFtMean: mean(surf),
      surfFtP25: quantile(surf, 0.25),
      surfFtP75: quantile(surf, 0.75),
      waterTempCMean: mean(numbers(list, (h) => h.obs.waterTempC)),
      goodDays: monthDays.filter((d) => d.good).length,
      days: monthDays.length,
      windAmMpsMean: wind(6, 10),
      windPmMpsMean: wind(12, 17),
    };
  });

  const windByHour: HourWindStat[] = Array.from({ length: 24 }, (_, hour) => {
    const list = hours.filter((h) => h.hour === hour && h.obs.windSpeedMps !== null);
    return {
      hour,
      speedMpsMean: mean(numbers(list, (h) => h.obs.windSpeedMps)),
      cleanShare: share(list, (h) => h.windClean),
      onshoreShare: share(list, (h) => h.windOnshore),
    };
  });

  const surfByMonthHour = Array.from({ length: 12 }, (_, month) =>
    Array.from({ length: 24 }, (_, hour) =>
      mean(hours.filter((h) => h.month === month && h.hour === hour && h.daylight).map((h) => h.score)),
    ),
  );

  const swellRose = rose(hours);
  const seasons: SeasonStat[] = (['winter', 'spring', 'summer', 'fall'] as const).map((season) => {
    const list = hours.filter((h) => SEASON_OF_MONTH[h.month] === season);
    const seasonDays = days.filter((d) => SEASON_OF_MONTH[monthOfDay(d)] === season);
    const seasonRose = rose(list);
    const top = seasonRose.reduce<DirectionBin | null>((best, b) => (!best || b.share > best.share ? b : best), null);
    return {
      season,
      surfFtMean: mean(list.filter((h) => h.daylight).map((h) => h.faceFt)),
      waterTempCMean: mean(numbers(list, (h) => h.obs.waterTempC)),
      goodDayShare: share(seasonDays, (d) => d.good),
      dominantSwell: top && top.share > 0 ? top.point : null,
    };
  });

  return {
    beachId: beach.id,
    provenance,
    from: observations[0]?.time ?? new Date(0).toISOString(),
    to: observations.at(-1)?.time ?? new Date(0).toISOString(),
    observationCount: observations.length,
    goodScore: GOOD_SURF_SCORE,
    months,
    days,
    windByHour,
    surfByMonthHour,
    swellRose,
    seasons,
  };
}

function scoreHour(beach: BeachConfig, obs: HistoricalObservation): ScoredHour {
  const ms = Date.parse(obs.time);
  const parts = zonedParts(ms, beach.timezone);
  const swells: SwellComponent[] = [];
  const add = (kind: SwellComponent['kind'], h: number | null, p: number | null, d: number | null) => {
    if (h !== null && p !== null && d !== null && h > 0) swells.push({ kind, heightM: h, periodS: p, dirDeg: d });
  };
  add('primary', obs.swellHeightM, obs.swellPeriodS, obs.swellDirDeg);
  add('secondary', obs.secondarySwellHeightM, obs.secondarySwellPeriodS, obs.secondarySwellDirDeg);
  add('wind', obs.windWaveHeightM, obs.windWavePeriodS, obs.windWaveDirDeg);

  const sunElevationDeg = sunPosition(ms, beach.lat, beach.lon).elevationDeg;
  const sample: ConditionsSample = {
    ms,
    airTempC: obs.airTempC,
    feelsLikeC: null,
    humidityPct: null,
    cloudCoverPct: null,
    precipProbabilityPct: null,
    precipitationMm: null,
    uvIndex: null,
    weatherCode: null,
    windSpeedMps: obs.windSpeedMps,
    windGustMps: null,
    windDirDeg: obs.windDirDeg,
    waveHeightM: null,
    swells,
    waterTempC: obs.waterTempC,
    tideM: obs.tideM,
    tideRateMPerHour: null,
    sunElevationDeg,
  };
  const { score, surf, wind } = scoreSurf(sample, beach.surf);
  const relation = wind?.relation;
  return {
    ms,
    date: localDayKey(ms, beach.timezone),
    month: parts.month - 1,
    hour: parts.hour,
    daylight: sunElevationDeg > -3,
    faceFt: surf.faceFt,
    score,
    obs,
    windClean: relation === 'calm' || relation === 'offshore' || relation === 'cross-offshore',
    windOnshore: relation === 'onshore' || relation === 'cross-onshore',
  };
}

function rose(hours: readonly ScoredHour[]): DirectionBin[] {
  const bins = COMPASS_POINTS.map((point, i) => ({ point, dirDeg: i * 22.5, count: 0, heights: [] as number[] }));
  let total = 0;
  for (const h of hours) {
    const { swellDirDeg, swellHeightM } = h.obs;
    if (swellDirDeg === null || swellHeightM === null || swellHeightM < 0.15) continue;
    const bin = bins[COMPASS_POINTS.indexOf(degreesToCompass(swellDirDeg))]!;
    bin.count++;
    bin.heights.push(metersToFeet(swellHeightM));
    total++;
  }
  return bins.map(({ point, dirDeg, count, heights }) => ({
    point,
    dirDeg,
    share: total === 0 ? 0 : count / total,
    heightFtMean: mean(heights),
  }));
}

function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = groups.get(k);
    if (list) list.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

function numbers<T>(items: readonly T[], get: (item: T) => number | null): number[] {
  return items.flatMap((item) => {
    const v = get(item);
    return v === null ? [] : [v];
  });
}

function share<T>(items: readonly T[], test: (item: T) => boolean): number {
  return items.length === 0 ? 0 : items.filter(test).length / items.length;
}
