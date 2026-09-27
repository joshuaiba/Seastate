import { describe, expect, it } from 'vitest';
import { moonPosition } from './moon';
import { sunPosition } from './sun';

const RAD = Math.PI / 180;

/** Angle between two sky positions, degrees. */
function separation(a: { elevationDeg: number; azimuthDeg: number }, b: { elevationDeg: number; azimuthDeg: number }) {
  const cos =
    Math.sin(a.elevationDeg * RAD) * Math.sin(b.elevationDeg * RAD) +
    Math.cos(a.elevationDeg * RAD) * Math.cos(b.elevationDeg * RAD) * Math.cos((a.azimuthDeg - b.azimuthDeg) * RAD);
  return Math.acos(Math.min(1, cos)) / RAD;
}

describe('moonPosition', () => {
  it('sits on the sun during a total solar eclipse, and is new', () => {
    // Totality over Dallas, 8 April 2024.
    const ms = Date.parse('2024-04-08T18:42:00Z');
    const dallas = { lat: 32.78, lon: -96.8 };
    const moon = moonPosition(ms, dallas.lat, dallas.lon);

    expect(separation(moon, sunPosition(ms, dallas.lat, dallas.lon))).toBeLessThan(1.5);
    expect(moon.illumination).toBeLessThan(0.01);
  });

  it('is full, and opposite the sun, at a lunar eclipse', () => {
    // Greatest eclipse, 28 August 2026, 04:13 UTC: evening moonrise season in California.
    const ms = Date.parse('2026-08-28T04:13:00Z');
    const moon = moonPosition(ms, 33.6553, -118.0053);
    const sun = sunPosition(ms, 33.6553, -118.0053);

    expect(moon.illumination).toBeGreaterThan(0.99);
    expect(separation(moon, sun)).toBeGreaterThan(177);
  });

  it('rises in the east as the full moon sets the sun', () => {
    // Sunset in Huntington Beach, 27 August 2026 (7:30 PM PDT).
    const moon = moonPosition(Date.parse('2026-08-28T02:30:00Z'), 33.6553, -118.0053);

    expect(moon.elevationDeg).toBeGreaterThan(0);
    expect(moon.elevationDeg).toBeLessThan(8);
    expect(moon.azimuthDeg).toBeGreaterThan(95);
    expect(moon.azimuthDeg).toBeLessThan(115);
  });

  it('waxes between new and full', () => {
    expect(moonPosition(Date.parse('2024-04-15T12:00:00Z'), 33.6, -118).waxing).toBe(true);
    expect(moonPosition(Date.parse('2024-04-30T12:00:00Z'), 33.6, -118).waxing).toBe(false);
  });
});
