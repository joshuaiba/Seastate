import { describe, expect, it } from 'vitest';
import { parseHourly, parseMarine, parseWeather } from './parser';

// Trimmed from real responses for Huntington Beach (timeformat=unixtime, timezone=GMT).

describe('parseMarine', () => {
  it('turns column arrays into one row per hour, with missing values as null', () => {
    const body = JSON.stringify({
      latitude: 33.625,
      longitude: -118.04166,
      hourly: {
        time: [1790380800, 1790384400],
        wave_height: [0.82, 0.8],
        swell_wave_height: [0.54, 0.54],
        swell_wave_direction: [196, 196],
        swell_wave_period: [9.55, 9.5],
        secondary_swell_wave_height: [0.34, null],
        sea_surface_temperature: [23.4, 23.4],
      },
    });

    const [first, second] = parseMarine(body);

    expect(first).toMatchObject({
      time: '2026-09-26T00:00:00.000Z',
      waveHeightM: 0.82,
      swellHeightM: 0.54,
      swellDirDeg: 196,
      swellPeriodS: 9.55,
      secondarySwellHeightM: 0.34,
      seaSurfaceTempC: 23.4,
      // Not in the response at all.
      windWaveHeightM: null,
    });
    expect(second?.secondarySwellHeightM).toBeNull();
  });
});

describe('parseWeather', () => {
  it('maps Open-Meteo variable names to ours', () => {
    const body = JSON.stringify({
      hourly: {
        time: [1790424000],
        temperature_2m: [17.5],
        apparent_temperature: [18.8],
        cloud_cover: [100],
        weather_code: [3],
        wind_speed_10m: [1.3],
        wind_direction_10m: [90],
        uv_index: [0],
      },
    });

    expect(parseWeather(body)).toEqual([
      {
        time: '2026-09-26T12:00:00.000Z',
        airTempC: 17.5,
        feelsLikeC: 18.8,
        humidityPct: null,
        precipProbabilityPct: null,
        precipitationMm: null,
        cloudCoverPct: 100,
        weatherCode: 3,
        windSpeedMps: 1.3,
        windDirDeg: 90,
        windGustMps: null,
        uvIndex: 0,
      },
    ]);
  });
});

describe('errors', () => {
  it("throws Open-Meteo's reason", () => {
    const body = '{"error":true,"reason":"Cannot initialize WeatherVariable from invalid String value wave_hieght"}';

    expect(() => parseHourly(body, {})).toThrow('Open-Meteo: Cannot initialize WeatherVariable');
  });

  it('throws on a body that is not JSON', () => {
    expect(() => parseHourly('<html>502 Bad Gateway</html>', {})).toThrow(/other than JSON/);
  });
});
