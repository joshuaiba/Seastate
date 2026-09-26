import type { DataMode, StationRef } from './common';
import type { TideCurveInterval, TideDatum } from './coops';

/** Shape of seastate.config.ts at the repo root. */
export interface SeastateConfig {
  /** The beaches the dashboard covers, in the order the beach selector shows them. The first is the default. */
  beaches: BeachConfig[];
  data: {
    /** Hours of observation history the API returns. */
    historyHours: number;
    /** Tide predictions cover now - tidePastHours to now + tideFutureHours. */
    tidePastHours: number;
    tideFutureHours: number;
    tideCurveIntervalMinutes: TideCurveInterval;
    tideDatum: TideDatum;
    /** How long each kind of upstream response is cached, in minutes. */
    cacheMinutes: { ndbc: number; coopsObservations: number; coopsPredictions: number };
  };
}

export interface BeachLocation {
  name: string;
  region: string;
  lat: number;
  lon: number;
  /** IANA timezone used for display, e.g. "America/Los_Angeles". The API itself is all UTC. */
  timezone: string;
}

export interface BeachConfig extends BeachLocation {
  /** URL-safe id, e.g. "huntington-beach". Used in API paths and in the page URL. */
  id: string;
  /** What the beach is known by, if anything, e.g. "Huntington Beach Pier". */
  landmark: string | null;
  surf: SurfProfile;
  stations: {
    /** NDBC buoy for waves, swell, and water temperature (and wind, if it has an anemometer). */
    ndbc: StationRef;
    /** CO-OPS station for tides, water level, water temperature, and wind. */
    coops: StationRef;
  };
}

/**
 * How a beach turns offshore swell and wind into surf. These numbers are what make the same swell
 * read differently at two beaches a few miles apart, so they're worth tuning from experience.
 */
export interface SurfProfile {
  /** Bearing from the sand straight out to sea, degrees true. Offshore wind blows from the opposite way. */
  facingDeg: number;
  /**
   * Swell directions the beach is open to. Exposure falls off smoothly from `centerDeg` to zero at
   * ±`halfWidthDeg`; islands, headlands, and breakwaters are what narrow it.
   */
  swellWindow: { centerDeg: number; halfWidthDeg: number };
  /** 0–1: how much of a swell at the center of the window reaches the beach. Sheltered beaches are lower. */
  exposure: number;
  /** Tide range the break works best in, m above MLLW. */
  idealTideM: [low: number, high: number];
}

/** A beach as the API describes it. */
export interface BeachInfo extends BeachConfig {
  tideDatum: TideDatum;
}

/** Response of GET /api/beaches. */
export interface BeachesResponse {
  mode: DataMode;
  beaches: BeachInfo[];
}

/** Response of GET /api/location: the default beach. Kept from the original single-beach API. */
export interface LocationInfo extends BeachInfo {
  mode: DataMode;
}
