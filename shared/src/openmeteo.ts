import type { IsoTime } from './common';

/**
 * One hour of the Open-Meteo weather forecast (https://open-meteo.com/en/docs), in SI units.
 * Values are the model's, not measurements. Past hours are the model's best estimate of what happened.
 */
export interface WeatherHour {
  time: IsoTime;
  /** Air temperature at 2 m, °C. */
  airTempC: number | null;
  /** Apparent ("feels like") temperature, °C: air temperature adjusted for humidity, wind, and sun. */
  feelsLikeC: number | null;
  humidityPct: number | null;
  /** Chance of at least 0.1 mm of precipitation in the hour, %. */
  precipProbabilityPct: number | null;
  /** Precipitation total for the preceding hour, mm. */
  precipitationMm: number | null;
  /** Total cloud cover, %. */
  cloudCoverPct: number | null;
  /** WMO weather interpretation code, e.g. 0 = clear, 3 = overcast, 45 = fog, 61 = light rain. */
  weatherCode: number | null;
  /** Wind at 10 m, m/s. */
  windSpeedMps: number | null;
  /** Direction the wind blows FROM, degrees true. */
  windDirDeg: number | null;
  windGustMps: number | null;
  uvIndex: number | null;
}

/**
 * One hour of the Open-Meteo marine forecast (https://open-meteo.com/en/docs/marine-weather-api).
 * The model splits the sea into a primary and secondary swell plus local wind waves. Directions are
 * where the waves come FROM, degrees true. Heights are significant heights, m.
 */
export interface MarineHour {
  time: IsoTime;
  /** Combined significant height of every wave train, m. */
  waveHeightM: number | null;
  waveDirDeg: number | null;
  wavePeriodS: number | null;
  swellHeightM: number | null;
  swellDirDeg: number | null;
  swellPeriodS: number | null;
  secondarySwellHeightM: number | null;
  secondarySwellDirDeg: number | null;
  secondarySwellPeriodS: number | null;
  windWaveHeightM: number | null;
  windWaveDirDeg: number | null;
  windWavePeriodS: number | null;
  /** Modeled sea surface temperature, °C. Coarser than a buoy's reading. */
  seaSurfaceTempC: number | null;
}

/**
 * Payload of GET /api/beaches/:beach/sources/openmeteo. Hourly rows run from a day before now to the
 * end of the forecast, oldest first. Each field is null if that request failed (see `warnings`).
 */
export interface OpenMeteoPayload {
  weather: WeatherHour[] | null;
  marine: MarineHour[] | null;
}
