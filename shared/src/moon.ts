import { DAY_MS } from './zoned';

/*
 * Moon position and phase from the low-precision lunar series in the Astronomical Almanac (the same
 * terms SunCalc uses). Good to a few tenths of a degree, which is plenty for placing the moon in the
 * hero scene and deciding how much moonlight falls on the water. Geocentric: the up-to-1° parallax of
 * a nearby observer is ignored.
 */

const RAD = Math.PI / 180;
const OBLIQUITY = 23.4397 * RAD;

export interface MoonPosition {
  /** Degrees above the horizon; negative when it has set. */
  elevationDeg: number;
  /** Compass bearing, degrees true. */
  azimuthDeg: number;
  /** Lit fraction of the disc, 0 (new) to 1 (full). */
  illumination: number;
  /** True from new moon to full. */
  waxing: boolean;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Ecliptic longitude and latitude of the moon, and of the sun, radians. */
function eclipticTerms(ms: number): { moonLon: number; moonLat: number; sunLon: number } {
  const d = ms / DAY_MS + 2440587.5 - 2451545; // days since J2000
  const meanLong = (218.316 + 13.176396 * d) * RAD;
  const meanAnomaly = (134.963 + 13.064993 * d) * RAD;
  const argLatitude = (93.272 + 13.22935 * d) * RAD;
  const sunAnomaly = (357.5291 + 0.98560028 * d) * RAD;
  const sunCenter = (1.9148 * Math.sin(sunAnomaly) + 0.02 * Math.sin(2 * sunAnomaly) + 0.0003 * Math.sin(3 * sunAnomaly)) * RAD;
  return {
    moonLon: meanLong + 6.289 * RAD * Math.sin(meanAnomaly),
    moonLat: 5.128 * RAD * Math.sin(argLatitude),
    // Perihelion longitude plus half a turn gives the sun's longitude as seen from Earth.
    sunLon: sunAnomaly + sunCenter + 102.9372 * RAD + Math.PI,
  };
}

export function moonPosition(ms: number, lat: number, lon: number): MoonPosition {
  const { moonLon, moonLat, sunLon } = eclipticTerms(ms);
  const rightAscension = Math.atan2(
    Math.sin(moonLon) * Math.cos(OBLIQUITY) - Math.tan(moonLat) * Math.sin(OBLIQUITY),
    Math.cos(moonLon),
  );
  const declination = Math.asin(
    Math.sin(moonLat) * Math.cos(OBLIQUITY) + Math.cos(moonLat) * Math.sin(OBLIQUITY) * Math.sin(moonLon),
  );

  const d = ms / DAY_MS + 2440587.5 - 2451545;
  const siderealTime = (280.16 + 360.9856235 * d) * RAD + lon * RAD;
  const hourAngle = siderealTime - rightAscension;
  const latRad = lat * RAD;
  const elevation = Math.asin(
    Math.sin(latRad) * Math.sin(declination) + Math.cos(latRad) * Math.cos(declination) * Math.cos(hourAngle),
  );
  const azimuth = Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(latRad) - Math.tan(declination) * Math.cos(latRad),
  );

  // Phase from the moon's elongation from the sun along the ecliptic.
  const elongation = mod(moonLon - sunLon, 2 * Math.PI);
  return {
    elevationDeg: elevation / RAD,
    azimuthDeg: mod(azimuth / RAD + 180, 360),
    illumination: (1 - Math.cos(elongation)) / 2,
    waxing: elongation < Math.PI,
  };
}
