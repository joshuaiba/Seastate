import type { IsoTime, StationRef } from '../common';
import type { BeachConfig } from '../config';
import type { CoopsPayload, TideDatum } from '../coops';
import type { NdbcPayload } from '../ndbc';
import type { MarineHour, OpenMeteoPayload, WeatherHour } from '../openmeteo';
import { sunPosition } from '../sun';
import { compassToDegrees } from '../units';
import { HOUR_MS, MINUTE_MS } from '../zoned';
import { clamp, lerp, lerpAngle } from './math';
import { tideHeightAt, tideRateAt, type TideSeries } from './tide';
import { indexAtOrBefore, withMs, type Timed } from './timeseries';

/*
 * Conditions: every source for one beach merged into a single hourly timeline.
 *
 * The forecast model (Open-Meteo) is the backbone because it's the only source that looks ahead. Where
 * a real measurement exists it takes over for "now", and it nudges the nearby model hours too:
 *   - Swell: the model's wave heights are scaled so they match the buoy right now, with the correction
 *     fading out over about half a day. Models are often a little high or low for days at a time, and
 *     this keeps "now" and the next few hours from disagreeing with the buoy.
 *   - Water temperature: the model's SST is shifted by however far it's off from the buoy.
 *   - Wind: a tide station's anemometer replaces the model for "now" when it has one.
 * Tide comes from NOAA's predictions, and sun position is computed, so both are exact at any minute.
 */

export interface SwellComponent {
  kind: 'primary' | 'secondary' | 'wind';
  /** Significant height, m. */
  heightM: number;
  periodS: number;
  /** Direction the waves come FROM, degrees true. */
  dirDeg: number;
}

/** Everything known about a beach at one instant. Nulls mean no source covered it. */
export interface ConditionsSample {
  ms: number;
  airTempC: number | null;
  feelsLikeC: number | null;
  humidityPct: number | null;
  cloudCoverPct: number | null;
  precipProbabilityPct: number | null;
  precipitationMm: number | null;
  uvIndex: number | null;
  /** WMO code (see weather.ts). */
  weatherCode: number | null;
  windSpeedMps: number | null;
  windGustMps: number | null;
  /** Direction the wind blows FROM, degrees true. */
  windDirDeg: number | null;
  /** Combined significant wave height offshore, m. */
  waveHeightM: number | null;
  /** Wave trains, biggest first. */
  swells: SwellComponent[];
  waterTempC: number | null;
  /** Predicted tide above the station datum, m. */
  tideM: number | null;
  /** m per hour; positive on an incoming tide. */
  tideRateMPerHour: number | null;
  sunElevationDeg: number;
}

export type Provenance = 'buoy' | 'tide-station' | 'model' | 'prediction';

/** Where a current reading came from, for the fine print. */
export interface SourceNote {
  source: Provenance;
  label: string;
  /** When it was measured, for observations. */
  time: IsoTime | null;
}

export interface WaveTrain {
  heightM: number;
  periodS: number | null;
  dirDeg: number | null;
}

/** The latest wave buoy report, as measured. */
export interface BuoyReading {
  station: StationRef;
  time: IsoTime;
  significantHeightM: number | null;
  dominantPeriodS: number | null;
  swell: WaveTrain | null;
  windWave: WaveTrain | null;
  waterTemp: { valueC: number; time: IsoTime } | null;
  /** Significant wave height across the observation window, oldest first. */
  history: { ms: number; heightM: number }[];
}

export interface TideData extends TideSeries {
  datum: TideDatum;
  /** Measured water level, where the station has a gauge. */
  observed: (Timed & { heightM: number })[];
  /** How far the latest measurement is above the prediction, m (surge, swell setup, or weather). */
  observedOffsetM: number | null;
}

export interface BeachConditions {
  beach: BeachConfig;
  now: number;
  /** Best estimate for right now: model interpolated to the minute, with observations swapped in. */
  current: ConditionsSample;
  sources: {
    weather: SourceNote | null;
    wind: SourceNote | null;
    swell: SourceNote | null;
    waterTemp: SourceNote | null;
    tide: SourceNote | null;
  };
  /** Hourly timeline, a day back through the end of the forecast, with the corrections above applied. */
  hourly: ConditionsSample[];
  tide: TideData;
  buoy: BuoyReading | null;
}

export interface ConditionsInput {
  beach: BeachConfig;
  now: number;
  ndbc: NdbcPayload | null;
  coops: CoopsPayload | null;
  openmeteo: OpenMeteoPayload | null;
}

/** How long a buoy reading counts as "now". Wave buoys report every 30 minutes. */
const BUOY_FRESH_MS = 3 * HOUR_MS;
const WATER_TEMP_FRESH_MS = 6 * HOUR_MS;
const WIND_FRESH_MS = 90 * MINUTE_MS;
/** Time constant for the buoy correction fading out of the forecast. */
const SWELL_CORRECTION_TAU_MS = 12 * HOUR_MS;

export function buildConditions({ beach, now, ndbc, coops, openmeteo }: ConditionsInput): BeachConditions {
  const tide = readTide(coops, now);
  const buoy = readBuoy(beach, ndbc);
  const raw = modelTimeline(withMs(openmeteo?.weather), withMs(openmeteo?.marine));
  const modelNow = interpolateSample(raw, now);

  // Swell calibration against the buoy.
  const buoyFresh = buoy !== null && now - Date.parse(buoy.time) <= BUOY_FRESH_MS;
  const modelHeight = modelNow?.waveHeightM ?? null;
  const swellRatio =
    buoyFresh && buoy.significantHeightM !== null && modelHeight !== null && modelHeight > 0.05
      ? clamp(buoy.significantHeightM / modelHeight, 0.6, 1.6)
      : 1;

  // Water temperature: buoy first, then the tide station's sensor.
  const waterObs = observedWaterTemp(buoy, coops, beach, now);
  const waterOffset =
    waterObs && modelNow?.waterTempC != null ? clamp(waterObs.valueC - modelNow.waterTempC, -4, 4) : 0;

  const hourly = raw.map((sample) => {
    const scale = 1 + (swellRatio - 1) * Math.exp(-Math.abs(sample.ms - now) / SWELL_CORRECTION_TAU_MS);
    return withExactTideAndSun(
      {
        ...sample,
        waveHeightM: sample.waveHeightM === null ? null : sample.waveHeightM * scale,
        swells: sample.swells.map((s) => ({ ...s, heightM: s.heightM * scale })),
        waterTempC: sample.waterTempC === null ? null : sample.waterTempC + waterOffset,
      },
      beach,
      tide,
    );
  });

  const conditions: BeachConditions = {
    beach,
    now,
    current: emptySample(now),
    sources: { weather: null, wind: null, swell: null, waterTemp: null, tide: null },
    hourly,
    tide,
    buoy,
  };

  const current = sampleAt(conditions, now);
  const modelNote: SourceNote = { source: 'model', label: 'Open-Meteo forecast model', time: null };
  const sources: BeachConditions['sources'] = {
    weather: hourly.length > 0 ? modelNote : null,
    wind: current.windSpeedMps !== null ? modelNote : null,
    swell: current.swells.length > 0 ? modelNote : null,
    waterTemp: current.waterTempC !== null ? { ...modelNote, label: 'Open-Meteo marine model' } : null,
    tide:
      current.tideM !== null
        ? { source: 'prediction', label: `NOAA tide predictions · ${beach.stations.coops.name}`, time: null }
        : null,
  };

  if (buoyFresh && swellRatio !== 1) {
    sources.swell = {
      source: 'buoy',
      label: `Marine model matched to buoy ${buoy.station.id} · ${buoy.station.name}`,
      time: buoy.time,
    };
  }
  if (waterObs) {
    current.waterTempC = waterObs.valueC;
    sources.waterTemp = waterObs.note;
  }
  const wind = observedWind(coops, now);
  if (wind) {
    current.windSpeedMps = wind.speedMps;
    current.windGustMps = wind.gustMps ?? current.windGustMps;
    current.windDirDeg = wind.dirDeg;
    sources.wind = {
      source: 'tide-station',
      label: `CO-OPS ${beach.stations.coops.id} · ${beach.stations.coops.name}`,
      time: wind.time,
    };
  }

  conditions.current = current;
  conditions.sources = sources;
  return conditions;
}

/** Conditions at any instant: the hourly timeline interpolated, with tide and sun computed exactly. */
export function sampleAt(conditions: BeachConditions, ms: number): ConditionsSample {
  const sample = interpolateSample(conditions.hourly, ms) ?? emptySample(ms);
  return withExactTideAndSun(sample, conditions.beach, conditions.tide);
}

function withExactTideAndSun(sample: ConditionsSample, beach: BeachConfig, tide: TideSeries): ConditionsSample {
  return {
    ...sample,
    tideM: tideHeightAt(tide, sample.ms),
    tideRateMPerHour: tideRateAt(tide, sample.ms),
    sunElevationDeg: sunPosition(sample.ms, beach.lat, beach.lon).elevationDeg,
  };
}

function emptySample(ms: number): ConditionsSample {
  return {
    ms,
    airTempC: null,
    feelsLikeC: null,
    humidityPct: null,
    cloudCoverPct: null,
    precipProbabilityPct: null,
    precipitationMm: null,
    uvIndex: null,
    weatherCode: null,
    windSpeedMps: null,
    windGustMps: null,
    windDirDeg: null,
    waveHeightM: null,
    swells: [],
    waterTempC: null,
    tideM: null,
    tideRateMPerHour: null,
    sunElevationDeg: 0,
  };
}

/** Joins the weather and marine forecasts hour by hour. */
function modelTimeline(weather: (WeatherHour & Timed)[], marine: (MarineHour & Timed)[]): ConditionsSample[] {
  const weatherByMs = new Map(weather.map((w) => [w.ms, w]));
  const marineByMs = new Map(marine.map((m) => [m.ms, m]));
  const times = [...new Set([...weatherByMs.keys(), ...marineByMs.keys()])].sort((a, b) => a - b);

  return times.map((ms) => {
    const w = weatherByMs.get(ms);
    const m = marineByMs.get(ms);
    return {
      ...emptySample(ms),
      airTempC: w?.airTempC ?? null,
      feelsLikeC: w?.feelsLikeC ?? null,
      humidityPct: w?.humidityPct ?? null,
      cloudCoverPct: w?.cloudCoverPct ?? null,
      precipProbabilityPct: w?.precipProbabilityPct ?? null,
      precipitationMm: w?.precipitationMm ?? null,
      uvIndex: w?.uvIndex ?? null,
      weatherCode: w?.weatherCode ?? null,
      windSpeedMps: w?.windSpeedMps ?? null,
      windGustMps: w?.windGustMps ?? null,
      windDirDeg: w?.windDirDeg ?? null,
      waveHeightM: m?.waveHeightM ?? null,
      swells: m ? marineSwells(m) : [],
      waterTempC: m?.seaSurfaceTempC ?? null,
    };
  });
}

function marineSwells(m: MarineHour): SwellComponent[] {
  const trains: [SwellComponent['kind'], number | null, number | null, number | null][] = [
    ['primary', m.swellHeightM, m.swellPeriodS, m.swellDirDeg],
    ['secondary', m.secondarySwellHeightM, m.secondarySwellPeriodS, m.secondarySwellDirDeg],
    ['wind', m.windWaveHeightM, m.windWavePeriodS, m.windWaveDirDeg],
  ];
  return trains
    .flatMap(([kind, heightM, periodS, dirDeg]): SwellComponent[] =>
      heightM !== null && periodS !== null && dirDeg !== null && heightM >= 0.05 && periodS > 0
        ? [{ kind, heightM, periodS, dirDeg }]
        : [],
    )
    .sort((a, b) => b.heightM - a.heightM);
}

/** Linear interpolation of every field between the two hourly samples around `ms`. */
function interpolateSample(hours: readonly ConditionsSample[], ms: number): ConditionsSample | null {
  const i = indexAtOrBefore(hours, ms);
  const a = hours[i];
  const b = hours[i + 1];
  if (!a && !b) return null;
  if (!a || !b) {
    const edge = (a ?? b)!;
    return Math.abs(edge.ms - ms) <= 1.5 * HOUR_MS ? { ...edge, ms } : null;
  }
  const t = (ms - a.ms) / (b.ms - a.ms);
  const num = (x: number | null, y: number | null) => (x === null ? y : y === null ? x : lerp(x, y, t));
  const ang = (x: number | null, y: number | null) => (x === null ? y : y === null ? x : lerpAngle(x, y, t));

  const swells = [...new Set([...a.swells, ...b.swells].map((s) => s.kind))].map((kind) => {
    const sa = a.swells.find((s) => s.kind === kind);
    const sb = b.swells.find((s) => s.kind === kind);
    if (!sa || !sb) return { ...(sa ?? sb)!, heightM: (sa ?? sb)!.heightM * (sa ? 1 - t : t) };
    return {
      kind,
      heightM: lerp(sa.heightM, sb.heightM, t),
      periodS: lerp(sa.periodS, sb.periodS, t),
      dirDeg: lerpAngle(sa.dirDeg, sb.dirDeg, t),
    };
  });

  return {
    ms,
    airTempC: num(a.airTempC, b.airTempC),
    feelsLikeC: num(a.feelsLikeC, b.feelsLikeC),
    humidityPct: num(a.humidityPct, b.humidityPct),
    cloudCoverPct: num(a.cloudCoverPct, b.cloudCoverPct),
    precipProbabilityPct: num(a.precipProbabilityPct, b.precipProbabilityPct),
    precipitationMm: num(a.precipitationMm, b.precipitationMm),
    uvIndex: num(a.uvIndex, b.uvIndex),
    // A weather code is a category; take the nearer hour's.
    weatherCode: t < 0.5 ? (a.weatherCode ?? b.weatherCode) : (b.weatherCode ?? a.weatherCode),
    windSpeedMps: num(a.windSpeedMps, b.windSpeedMps),
    windGustMps: num(a.windGustMps, b.windGustMps),
    windDirDeg: ang(a.windDirDeg, b.windDirDeg),
    waveHeightM: num(a.waveHeightM, b.waveHeightM),
    swells: swells.filter((s) => s.heightM >= 0.05).sort((x, y) => y.heightM - x.heightM),
    waterTempC: num(a.waterTempC, b.waterTempC),
    tideM: num(a.tideM, b.tideM),
    tideRateMPerHour: num(a.tideRateMPerHour, b.tideRateMPerHour),
    sunElevationDeg: lerp(a.sunElevationDeg, b.sunElevationDeg, t),
  };
}

function readTide(coops: CoopsPayload | null, now: number): TideData {
  const tide: TideSeries = { curve: withMs(coops?.tideCurve), extremes: withMs(coops?.tideExtremes) };
  const observed = withMs(coops?.waterLevel).flatMap((row) =>
    row.heightM === null ? [] : [{ ms: row.ms, heightM: row.heightM }],
  );
  const latest = observed.at(-1);
  const predicted = latest && now - latest.ms <= HOUR_MS ? tideHeightAt(tide, latest.ms) : null;
  return {
    ...tide,
    datum: coops?.datum ?? 'MLLW',
    observed,
    observedOffsetM: latest && predicted !== null ? latest.heightM - predicted : null,
  };
}

function readBuoy(beach: BeachConfig, ndbc: NdbcPayload | null): BuoyReading | null {
  if (!ndbc) return null;
  const summary = [...(ndbc.waveSummary ?? [])].reverse().find((row) => row.significantHeightM !== null);
  const latest = ndbc.latest;
  const time = summary?.time ?? latest?.waveHeightM?.time;
  if (!time) return null;

  const train = (heightM: number | null, periodS: number | null, dirDeg: number | null): WaveTrain | null =>
    heightM === null ? null : { heightM, periodS, dirDeg };

  return {
    station: beach.stations.ndbc,
    time,
    significantHeightM: summary?.significantHeightM ?? latest?.waveHeightM?.value ?? null,
    dominantPeriodS: latest?.dominantPeriodS?.value ?? null,
    swell: summary
      ? train(summary.swellHeightM, summary.swellPeriodS, summary.swellDir && compassToDegrees(summary.swellDir))
      : null,
    windWave: summary
      ? train(
          summary.windWaveHeightM,
          summary.windWavePeriodS,
          summary.windWaveDir && compassToDegrees(summary.windWaveDir),
        )
      : null,
    waterTemp: latest?.waterTempC ? { valueC: latest.waterTempC.value, time: latest.waterTempC.time } : null,
    history: (ndbc.observations ?? []).flatMap((row) =>
      row.waveHeightM === null ? [] : [{ ms: Date.parse(row.time), heightM: row.waveHeightM }],
    ),
  };
}

function observedWaterTemp(
  buoy: BuoyReading | null,
  coops: CoopsPayload | null,
  beach: BeachConfig,
  now: number,
): { valueC: number; note: SourceNote } | null {
  if (buoy?.waterTemp && now - Date.parse(buoy.waterTemp.time) <= WATER_TEMP_FRESH_MS) {
    return {
      valueC: buoy.waterTemp.valueC,
      note: { source: 'buoy', label: `Buoy ${buoy.station.id} · ${buoy.station.name}`, time: buoy.waterTemp.time },
    };
  }
  const station = [...(coops?.waterTemperature ?? [])].reverse().find((row) => row.tempC !== null);
  if (station?.tempC != null && now - Date.parse(station.time) <= WATER_TEMP_FRESH_MS) {
    return {
      valueC: station.tempC,
      note: {
        source: 'tide-station',
        label: `CO-OPS ${beach.stations.coops.id} · ${beach.stations.coops.name}`,
        time: station.time,
      },
    };
  }
  return null;
}

function observedWind(
  coops: CoopsPayload | null,
  now: number,
): { speedMps: number; gustMps: number | null; dirDeg: number; time: IsoTime } | null {
  const row = [...(coops?.wind ?? [])].reverse().find((r) => r.speedMps !== null && r.dirDeg !== null);
  if (!row || row.speedMps === null || row.dirDeg === null) return null;
  if (now - Date.parse(row.time) > WIND_FRESH_MS) return null;
  return { speedMps: row.speedMps, gustMps: row.gustMps, dirDeg: row.dirDeg, time: row.time };
}
