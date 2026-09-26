import type { IsoTime } from './common';

/** Vertical reference for water heights. MLLW (Mean Lower Low Water) is the US tide-table standard. */
export type TideDatum = 'MLLW' | 'MLW' | 'MSL' | 'MTL' | 'MHW' | 'MHHW' | 'NAVD' | 'STND';

/** Minute intervals CO-OPS accepts for fixed-interval tide predictions. */
export type TideCurveInterval = 1 | 5 | 6 | 10 | 15 | 30 | 60;

/** A predicted high or low tide. */
export interface TideExtreme {
  time: IsoTime;
  /** Height above the datum, m. */
  heightM: number;
  type: 'high' | 'low';
}

/** A point on the predicted tide curve. */
export interface TidePoint {
  time: IsoTime;
  /** Height above the datum, m. */
  heightM: number;
}

/**
 * Measured water level (6-minute data). This is the astronomical tide plus weather effects such as
 * storm surge, so comparing it with the predicted curve shows how far conditions are from normal.
 */
export interface WaterLevelObservation {
  time: IsoTime;
  /** Height above the datum, m. */
  heightM: number | null;
  /** "preliminary" is raw real-time data. NOAA replaces it with "verified" data weeks to months later. */
  quality: 'preliminary' | 'verified';
}

export interface WaterTempObservation {
  time: IsoTime;
  tempC: number | null;
}

/** Wind measured at the tide station. Only stations with an anemometer report it. */
export interface WindObservation {
  time: IsoTime;
  speedMps: number | null;
  gustMps: number | null;
  /** Direction the wind blows FROM, degrees true. */
  dirDeg: number | null;
}

/**
 * Payload of GET /api/sources/coops. Series are oldest first. Each product is null if the station
 * doesn't offer it or the request failed (the response's `warnings` say why).
 */
export interface CoopsPayload {
  datum: TideDatum;
  /** Predicted highs and lows across the tide window. */
  tideExtremes: TideExtreme[] | null;
  /** Predicted height at a fixed interval across the tide window. */
  tideCurve: TidePoint[] | null;
  waterLevel: WaterLevelObservation[] | null;
  waterTemperature: WaterTempObservation[] | null;
  wind: WindObservation[] | null;
}
