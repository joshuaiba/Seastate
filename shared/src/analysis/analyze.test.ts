import { describe, expect, it } from 'vitest';
import type { BeachConfig } from '../config';
import type { CoopsPayload } from '../coops';
import type { NdbcPayload } from '../ndbc';
import type { MarineHour, OpenMeteoPayload, WeatherHour } from '../openmeteo';
import { HOUR_MS, localHour } from '../zoned';
import { analyzeBeach } from './analyze';
import { buildConditions, sampleAt } from './conditions';

const BEACH: BeachConfig = {
  id: 'huntington-beach',
  name: 'Huntington Beach',
  region: 'Orange County, CA',
  lat: 33.6553,
  lon: -118.0053,
  timezone: 'America/Los_Angeles',
  landmark: 'Huntington Beach Pier',
  surf: { facingDeg: 214, swellWindow: { centerDeg: 222, halfWidthDeg: 85 }, exposure: 1, idealTideM: [0.45, 1.25] },
  stations: { ndbc: { id: '46253', name: 'San Pedro South' }, coops: { id: '9410580', name: 'Newport Bay Entrance' } },
};

// 8 AM in Huntington Beach.
const NOW = Date.parse('2026-09-26T15:00:00Z');

/** A textbook Southern California day: offshore morning, sea breeze from late morning, clear skies. */
function forecast({ swellM = 1, periodS = 14 } = {}): OpenMeteoPayload {
  const weather: WeatherHour[] = [];
  const marine: MarineHour[] = [];
  for (let ms = NOW - 24 * HOUR_MS; ms <= NOW + 72 * HOUR_MS; ms += HOUR_MS) {
    const hour = localHour(ms, BEACH.timezone);
    const seaBreeze = hour >= 11 && hour < 19;
    const time = new Date(ms).toISOString();
    weather.push({
      time,
      airTempC: seaBreeze ? 23 : 18,
      feelsLikeC: seaBreeze ? 24 : 18,
      humidityPct: 70,
      precipProbabilityPct: 0,
      precipitationMm: 0,
      cloudCoverPct: 10,
      weatherCode: 0,
      windSpeedMps: seaBreeze ? 5 : 1.5,
      windDirDeg: seaBreeze ? 245 : 40,
      windGustMps: null,
      uvIndex: seaBreeze ? 6 : 1,
    });
    marine.push({
      time,
      waveHeightM: swellM,
      waveDirDeg: 200,
      wavePeriodS: periodS,
      swellHeightM: swellM,
      swellDirDeg: 200,
      swellPeriodS: periodS,
      secondarySwellHeightM: null,
      secondarySwellDirDeg: null,
      secondarySwellPeriodS: null,
      windWaveHeightM: null,
      windWaveDirDeg: null,
      windWavePeriodS: null,
      seaSurfaceTempC: 22,
    });
  }
  return { weather, marine };
}

const buoy: NdbcPayload = {
  latest: { waterTempC: { value: 20.5, time: new Date(NOW - 20 * 60_000).toISOString() } },
  observations: [],
  waveSummary: [
    {
      time: new Date(NOW - 20 * 60_000).toISOString(),
      significantHeightM: 1.2,
      swellHeightM: 1.1,
      swellPeriodS: 15,
      swellDir: 'SSW',
      windWaveHeightM: 0.3,
      windWavePeriodS: 5,
      windWaveDir: 'W',
      steepness: null,
      averagePeriodS: 8,
      meanWaveDirDeg: 200,
    },
  ],
};

const tides: CoopsPayload = {
  datum: 'MLLW',
  tideExtremes: [
    { time: '2026-09-26T12:00:00.000Z', heightM: 0.2, type: 'low' },
    { time: '2026-09-26T18:00:00.000Z', heightM: 1.5, type: 'high' },
    { time: '2026-09-27T00:30:00.000Z', heightM: 0.6, type: 'low' },
  ],
  tideCurve: null,
  waterLevel: null,
  waterTemperature: null,
  wind: null,
};

describe('buildConditions', () => {
  const conditions = buildConditions({ beach: BEACH, now: NOW, ndbc: buoy, coops: tides, openmeteo: forecast() });

  it('matches the model swell to the buoy now, and lets the correction fade', () => {
    expect(conditions.current.waveHeightM).toBeCloseTo(1.2, 2);
    const nextDay = sampleAt(conditions, NOW + 48 * HOUR_MS);
    expect(nextDay.waveHeightM).toBeLessThan(1.01);
    expect(conditions.sources.swell?.source).toBe('buoy');
  });

  it('uses the buoy water temperature now and shifts the model by the same amount', () => {
    expect(conditions.current.waterTempC).toBe(20.5);
    expect(sampleAt(conditions, NOW + 24 * HOUR_MS).waterTempC).toBeCloseTo(20.5, 5);
  });

  it('interpolates the tide between high and low when there is no curve', () => {
    // 8 AM is halfway from the 5 AM low to the 11 AM high.
    expect(conditions.current.tideM).toBeCloseTo(0.85, 2);
    expect(conditions.current.tideRateMPerHour).toBeGreaterThan(0);
  });
});

describe('analyzeBeach', () => {
  const analysis = analyzeBeach(
    buildConditions({ beach: BEACH, now: NOW, ndbc: buoy, coops: tides, openmeteo: forecast() }),
  );

  it('finds the morning surf window before the sea breeze', () => {
    const surf = analysis.upcoming.surf;
    expect(surf?.dayOffset).toBe(0);
    expect(surf?.active).toBe(true);
    expect(localHour(surf!.window.endMs, BEACH.timezone)).toBeLessThanOrEqual(11);
    expect(surf?.tideTrend).toBe('rising');
  });

  it('writes summaries from the data', () => {
    expect(analysis.summaries.surf.text).toMatch(/^Clean with light offshore wind until about 1[01](:30)? AM, when the onshore breeze fills in\.$/);
    expect(analysis.verdict).toMatchObject({ tone: 'go', eyebrow: 'Worth going', activity: 'surf' });
    expect(analysis.days.length).toBeGreaterThanOrEqual(2);
    expect(analysis.days[0]?.surf.label).toMatch(/ft$/);
  });
});
