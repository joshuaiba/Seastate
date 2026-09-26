import { DAY_MS, MINUTE_MS, zonedParts, zonedTime } from './zoned';

/*
 * Sun position and sunrise/sunset from NOAA's solar calculator equations
 * (https://gml.noaa.gov/grad/solcalc/calcdetails.html). Accurate to about a minute for these latitudes,
 * and it needs no API: the hero's lighting, night shading on charts, and daylight-only surf windows
 * all come from here, offline mode included.
 */

const RAD = Math.PI / 180;

export interface SunPosition {
  /** Degrees above the horizon; negative at night. */
  elevationDeg: number;
  /** Compass bearing of the sun, degrees true. */
  azimuthDeg: number;
}

export interface SunTimes {
  /** Civil dawn: sun 6° below the horizon, bright enough to see the water. Epoch ms. */
  dawn: number;
  sunrise: number;
  solarNoon: number;
  sunset: number;
  /** Civil dusk. */
  dusk: number;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

interface SolarTerms {
  declinationRad: number;
  /** Equation of time, minutes: how far sundial time runs ahead of clock time. */
  equationOfTimeMin: number;
}

function solarTerms(ms: number): SolarTerms {
  const t = (ms / DAY_MS + 2440587.5 - 2451545) / 36525; // Julian centuries since J2000
  const meanLong = mod(280.46646 + t * (36000.76983 + t * 0.0003032), 360);
  const meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const center =
    Math.sin(meanAnomaly * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * meanAnomaly * RAD) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * meanAnomaly * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const apparentLong = meanLong + center - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const meanObliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * Math.cos(omega * RAD);
  const declinationRad = Math.asin(Math.sin(obliquity * RAD) * Math.sin(apparentLong * RAD));

  const y = Math.tan((obliquity * RAD) / 2) ** 2;
  const l = meanLong * RAD;
  const m = meanAnomaly * RAD;
  const e = eccentricity;
  const equationOfTimeMin =
    (4 / RAD) *
    (y * Math.sin(2 * l) -
      2 * e * Math.sin(m) +
      4 * e * y * Math.sin(m) * Math.cos(2 * l) -
      0.5 * y * y * Math.sin(4 * l) -
      1.25 * e * e * Math.sin(2 * m));
  return { declinationRad, equationOfTimeMin };
}

export function sunPosition(ms: number, lat: number, lon: number): SunPosition {
  const { declinationRad: decl, equationOfTimeMin } = solarTerms(ms);
  const trueSolarMin = mod(mod(ms / MINUTE_MS, 1440) + equationOfTimeMin + 4 * lon, 1440);
  const hourAngle = (trueSolarMin / 4 - 180) * RAD;
  const latRad = lat * RAD;

  const cosZenith =
    Math.sin(latRad) * Math.sin(decl) + Math.cos(latRad) * Math.cos(decl) * Math.cos(hourAngle);
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZenith)));
  const azimuth = Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(latRad) - Math.tan(decl) * Math.cos(latRad),
  );
  return { elevationDeg: 90 - zenith / RAD, azimuthDeg: mod(azimuth / RAD + 180, 360) };
}

/** Sunrise, sunset, and civil twilight for the local day containing `ms`, as epoch ms. */
export function sunTimes(ms: number, lat: number, lon: number, timeZone: string): SunTimes {
  const { year, month, day } = zonedParts(ms, timeZone);
  const localNoon = zonedTime(timeZone, year, month, day, 12);

  const { equationOfTimeMin } = solarTerms(localNoon);
  let solarNoon = Math.floor(localNoon / DAY_MS) * DAY_MS + (720 - 4 * lon - equationOfTimeMin) * MINUTE_MS;
  while (solarNoon - localNoon > DAY_MS / 2) solarNoon -= DAY_MS;
  while (localNoon - solarNoon > DAY_MS / 2) solarNoon += DAY_MS;

  const latRad = lat * RAD;
  /** When the sun crosses `zenithDeg` before (-1) or after (+1) noon. Refined once at the event time. */
  const crossing = (zenithDeg: number, side: -1 | 1): number => {
    let time = solarNoon;
    for (let i = 0; i < 2; i++) {
      const decl = solarTerms(time).declinationRad;
      const cosH =
        (Math.cos(zenithDeg * RAD) - Math.sin(latRad) * Math.sin(decl)) / (Math.cos(latRad) * Math.cos(decl));
      // Polar day or night; can't happen at these latitudes, but keep the result finite.
      const hourAngleDeg = Math.acos(Math.min(1, Math.max(-1, cosH))) / RAD;
      time = solarNoon + side * 4 * hourAngleDeg * MINUTE_MS;
    }
    return time;
  };

  return {
    dawn: crossing(96, -1),
    sunrise: crossing(90.833, -1),
    solarNoon,
    sunset: crossing(90.833, 1),
    dusk: crossing(96, 1),
  };
}
