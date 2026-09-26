import { describe, expect, it } from 'vitest';
import { sunPosition, sunTimes } from './sun';
import { MINUTE_MS } from './zoned';

const HB = { lat: 33.6553, lon: -118.0053, tz: 'America/Los_Angeles' };

// Reference times from Open-Meteo's daily sunrise/sunset for the same coordinates.
describe('sunTimes', () => {
  it('matches published sunrise and sunset within two minutes (summer time)', () => {
    const times = sunTimes(Date.parse('2026-09-26T19:00:00Z'), HB.lat, HB.lon, HB.tz);

    expect(Math.abs(times.sunrise - Date.parse('2026-09-26T13:42:58Z'))).toBeLessThan(2 * MINUTE_MS);
    expect(Math.abs(times.sunset - Date.parse('2026-09-27T01:42:55Z'))).toBeLessThan(2 * MINUTE_MS);
    expect(times.dawn).toBeLessThan(times.sunrise);
    expect(times.dusk).toBeGreaterThan(times.sunset);
  });

  it('matches in winter, and picks the local day even when sunset is the next UTC day', () => {
    // 11 PM local on Dec 21 is already Dec 22 in UTC.
    const times = sunTimes(Date.parse('2025-12-22T07:00:00Z'), HB.lat, HB.lon, HB.tz);

    expect(Math.abs(times.sunrise - Date.parse('2025-12-21T14:52:39Z'))).toBeLessThan(2 * MINUTE_MS);
    expect(Math.abs(times.sunset - Date.parse('2025-12-22T00:47:34Z'))).toBeLessThan(2 * MINUTE_MS);
  });
});

describe('sunPosition', () => {
  it('puts the sun on the horizon at sunrise, in the east', () => {
    const { elevationDeg, azimuthDeg } = sunPosition(Date.parse('2026-09-26T13:42:58Z'), HB.lat, HB.lon);

    expect(elevationDeg).toBeCloseTo(-0.8, 0);
    expect(azimuthDeg).toBeGreaterThan(85);
    expect(azimuthDeg).toBeLessThan(100);
  });

  it('puts the sun high in the south at solar noon', () => {
    const { elevationDeg, azimuthDeg } = sunPosition(Date.parse('2026-09-26T19:43:00Z'), HB.lat, HB.lon);

    // 90° - latitude + declination (about -1.5° in late September).
    expect(elevationDeg).toBeCloseTo(54.8, 0);
    expect(Math.abs(azimuthDeg - 180)).toBeLessThan(2);
  });
});
