import type { IsoTime } from './common';
import type { LatestReadings } from './latest';
import type { CompassPoint } from './units';

/**
 * One row of an NDBC standard meteorological file (realtime2/<STATION>.txt), in SI units.
 * `null` means the station didn't report that field at that time; most stations only have sensors
 * for some of the columns. Field definitions: https://www.ndbc.noaa.gov/faq/measdes.shtml
 */
export interface BuoyObservation {
  time: IsoTime;
  /** WDIR: direction the wind blows FROM, degrees true (0 = north, 90 = east). */
  windDirDeg: number | null;
  /** WSPD: wind speed averaged over 8 minutes (buoys) or 2 minutes (land stations), m/s. */
  windSpeedMps: number | null;
  /** GST: peak 5- or 8-second gust during that averaging period, m/s. */
  windGustMps: number | null;
  /** WVHT: significant wave height, the average of the highest third of waves in a 20-minute sample, m. */
  waveHeightM: number | null;
  /** DPD: dominant wave period, the period carrying the most wave energy, s. */
  dominantPeriodS: number | null;
  /** APD: average period of all waves in the 20-minute sample, s. */
  averagePeriodS: number | null;
  /** MWD: direction the dominant-period waves come FROM, degrees true. */
  meanWaveDirDeg: number | null;
  /** PRES: sea-level air pressure, hPa. */
  pressureHpa: number | null;
  /** ATMP: air temperature, °C. */
  airTempC: number | null;
  /** WTMP: sea surface temperature, °C. */
  waterTempC: number | null;
  /** DEWP: dew point, °C. */
  dewPointC: number | null;
  /** VIS: visibility, nautical miles (rarely reported). */
  visibilityNmi: number | null;
  /** PTDY: pressure change over the 3 hours ending at this observation, hPa. */
  pressureTendencyHpa: number | null;
  /** TIDE: water level relative to MLLW, m. NDBC publishes it in feet; only a few coastal stations report it. */
  tideM: number | null;
}

/** NDBC's classification of wave height relative to wavelength. Steeper seas are choppier. */
export type WaveSteepness = 'SWELL' | 'AVERAGE' | 'STEEP' | 'VERY_STEEP';

/**
 * One row of an NDBC spectral wave summary (realtime2/<STATION>.spec).
 * NDBC splits the measured wave energy at a separation frequency into swell (longer-period waves
 * from distant storms) and wind waves (shorter-period waves raised by local wind). For surf, the swell
 * numbers are the ones that matter.
 */
export interface WaveSummary {
  time: IsoTime;
  /** WVHT: significant height of all waves combined, m. */
  significantHeightM: number | null;
  /** SwH: swell height, m. */
  swellHeightM: number | null;
  /** SwP: swell period, s. */
  swellPeriodS: number | null;
  /** SwD: direction the swell comes FROM. NDBC gives a compass point here, not degrees. */
  swellDir: CompassPoint | null;
  /** WWH: wind-wave height, m. */
  windWaveHeightM: number | null;
  /** WWP: wind-wave period, s. */
  windWavePeriodS: number | null;
  /** WWD: direction the wind waves come FROM (compass point). */
  windWaveDir: CompassPoint | null;
  /** STEEPNESS: see WaveSteepness. */
  steepness: WaveSteepness | null;
  /** APD: average wave period, s. */
  averagePeriodS: number | null;
  /** MWD: direction the dominant-period waves come FROM, degrees true. */
  meanWaveDirDeg: number | null;
}

/**
 * Payload of GET /api/sources/ndbc. Series are oldest first and trimmed to the configured history
 * window. Each field is null if that data couldn't be loaded (the response's `warnings` say why).
 */
export interface NdbcPayload {
  /**
   * Latest value of each field, taken from the station's full 45-day file. A sensor that has gone
   * quiet still shows its last value, and the time says how old it is.
   */
  latest: LatestReadings<BuoyObservation> | null;
  observations: BuoyObservation[] | null;
  /** Swell vs. wind-wave breakdown. Only stations that measure waves publish one. */
  waveSummary: WaveSummary[] | null;
}
