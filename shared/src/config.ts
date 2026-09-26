import type { DataMode, StationRef } from './common';
import type { TideCurveInterval, TideDatum } from './coops';

/** Shape of seastate.config.ts at the repo root. */
export interface SeastateConfig {
  location: BeachLocation;
  stations: {
    /** NDBC buoy for waves, swell, and water temperature (and wind, if it has an anemometer). */
    ndbc: StationRef;
    /** CO-OPS station for tides, water level, water temperature, and wind. */
    coops: StationRef;
  };
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

/** Response of GET /api/location. */
export interface LocationInfo extends BeachLocation {
  stations: SeastateConfig['stations'];
  tideDatum: TideDatum;
  mode: DataMode;
}
