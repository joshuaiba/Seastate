import type {
  DataMode,
  TideCurveInterval,
  TideDatum,
  TideExtreme,
  TidePoint,
  WaterLevelObservation,
  WaterTempObservation,
  WindObservation,
} from '@seastate/shared';
import { loadRows, type Upstream } from '../../lib/upstream';
import {
  parseTideCurve,
  parseTideExtremes,
  parseWaterLevel,
  parseWaterTemperature,
  parseWind,
} from './parser';

/*
 * NOAA CO-OPS (Center for Operational Oceanographic Products and Services) client, a.k.a. Tides & Currents.
 * API reference: https://api.tidesandcurrents.noaa.gov/api/prod/
 * No API key, but CO-OPS asks each caller to name its app with `application=`. Each request's time
 * span is capped (e.g. 31 days of 6-minute data), which is far more than a dashboard needs.
 */

const DATAGETTER = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
const APPLICATION = 'seastate';

type CoopsProduct = 'predictions' | 'water_level' | 'water_temperature' | 'wind';

export interface TimeRange {
  begin: Date;
  end: Date;
}

export interface CoopsFetchOptions {
  /** "fixture" reads server/fixtures/coops/ instead of calling CO-OPS. Default "live". */
  mode?: DataMode;
}

export interface WaterHeightOptions extends CoopsFetchOptions {
  /** What heights are measured from. Default MLLW. */
  datum?: TideDatum;
}

/** Predicted high and low tides within `range`. */
export function fetchTideExtremes(
  stationId: string,
  range: TimeRange,
  { mode = 'live', datum = 'MLLW' }: WaterHeightOptions = {},
): Promise<TideExtreme[]> {
  const upstream = datagetter(stationId, 'predictions', range, { datum, interval: 'hilo' }, 'predictions-hilo');
  return loadRows(upstream, mode, parseTideExtremes);
}

/**
 * Predicted tide height every `intervalMinutes` within `range`, for drawing the tide curve. Only
 * harmonic stations support this; subordinate stations have high/low predictions only.
 */
export function fetchTideCurve(
  stationId: string,
  range: TimeRange,
  { mode = 'live', datum = 'MLLW', intervalMinutes = 6 }: WaterHeightOptions & { intervalMinutes?: TideCurveInterval } = {},
): Promise<TidePoint[]> {
  const upstream = datagetter(stationId, 'predictions', range, { datum, interval: String(intervalMinutes) }, 'predictions-curve');
  return loadRows(upstream, mode, parseTideCurve);
}

/** Measured water level (6-minute data) within `range`. */
export function fetchWaterLevel(
  stationId: string,
  range: TimeRange,
  { mode = 'live', datum = 'MLLW' }: WaterHeightOptions = {},
): Promise<WaterLevelObservation[]> {
  return loadRows(datagetter(stationId, 'water_level', range, { datum }), mode, parseWaterLevel);
}

/** Water temperature (6-minute data) within `range`. Only stations with a temperature sensor. */
export function fetchWaterTemperature(
  stationId: string,
  range: TimeRange,
  { mode = 'live' }: CoopsFetchOptions = {},
): Promise<WaterTempObservation[]> {
  return loadRows(datagetter(stationId, 'water_temperature', range), mode, parseWaterTemperature);
}

/** Wind speed, gust, and direction (6-minute data) within `range`. Only stations with an anemometer. */
export function fetchWind(
  stationId: string,
  range: TimeRange,
  { mode = 'live' }: CoopsFetchOptions = {},
): Promise<WindObservation[]> {
  return loadRows(datagetter(stationId, 'wind', range), mode, parseWind);
}

/**
 * Builds a datagetter request. Units are always metric and times GMT; the parsers rely on both.
 * `fixtureName` tells apart different requests for the same product (hilo vs. interval predictions).
 */
function datagetter(
  stationId: string,
  product: CoopsProduct,
  range: TimeRange,
  params: Record<string, string> = {},
  fixtureName: string = product,
): Upstream {
  const query = new URLSearchParams({
    ...params,
    product,
    station: stationId,
    begin_date: formatCoopsDate(range.begin),
    end_date: formatCoopsDate(range.end),
    units: 'metric',
    time_zone: 'gmt',
    format: 'json',
    application: APPLICATION,
  });
  return { url: `${DATAGETTER}?${query}`, fixture: `coops/${stationId}/${fixtureName}.json` };
}

/** CO-OPS date format, "yyyyMMdd HH:mm" (in GMT here). */
function formatCoopsDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
  return `${day} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}
