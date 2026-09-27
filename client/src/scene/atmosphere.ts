import type { Camera } from './camera';
import { fromLin, mixLin, rgba, toLin, type Lin } from './color';
import type { Palette } from './palette';

/*
 * Aerial perspective for the 2D layer, matching the sea shader: things fade toward the color of the sky
 * just above the horizon at their own bearing, including the sun's glow, so a pier end against the
 * sunset goes amber while one against open sky goes blue-gray. The air is densest at the water (marine
 * haze) and thins with height, so a ridge's base disappears before its crest does.
 */

export type Vec3 = readonly [number, number, number];

export interface Air {
  cam: Camera;
  pal: Palette;
  sunDir: Vec3;
  /** The sun's glow color times its strength, linear. */
  sunGlow: Lin;
  skyZenith: Lin;
  skyMid: Lin;
  skyHorizon: Lin;
  /** Sea-level visibility, m, after weather. */
  visibilityM: number;
  seaHaze: number;
}

const HAZE_SCALE_M = 900;

export function makeAir(cam: Camera, pal: Palette, sunDir: Vec3, visibilityM: number, seaHaze: number): Air {
  const k = pal.glowStrength;
  const glow = toLin(pal.sunGlow);
  return {
    cam,
    pal,
    sunDir,
    sunGlow: [glow[0] * k, glow[1] * k, glow[2] * k],
    skyZenith: [pal.zenith[0] / 255, pal.zenith[1] / 255, pal.zenith[2] / 255],
    skyMid: [pal.mid[0] / 255, pal.mid[1] / 255, pal.mid[2] / 255],
    skyHorizon: [pal.horizon[0] / 255, pal.horizon[1] / 255, pal.horizon[2] / 255],
    visibilityM,
    seaHaze,
  };
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The sky's color in world direction d, linear (the shader's skyColor, without the moon). */
function skyLin(air: Air, d: Vec3): Lin {
  const el = Math.asin(Math.min(1, Math.max(0, d[1])));
  const t = 1 - Math.exp(-el / 0.2);
  const srgb =
    t < 0.45 ? mixLin(air.skyHorizon, air.skyMid, t / 0.45) : mixLin(air.skyMid, air.skyZenith, smoothstep(0.45, 0.85, t));
  const base: Lin = [srgb[0] ** 2.2, srgb[1] ** 2.2, srgb[2] ** 2.2];
  const cos = d[0] * air.sunDir[0] + d[1] * air.sunDir[1] + d[2] * air.sunDir[2];
  const g = Math.acos(Math.min(1, Math.max(-1, cos)));
  const band = Math.exp(-Math.max(d[1], 0) / 0.05) * Math.exp((-g * g) / 0.9) * air.pal.golden;
  const glow = 0.9 * Math.exp(-g / 0.05) + 0.35 * Math.exp(-g / 0.5) + band * 0.9;
  return [base[0] + air.sunGlow[0] * glow, base[1] + air.sunGlow[1] * glow, base[2] + air.sunGlow[2] * glow];
}

/** Haze color looking toward (X, Z) from the camera, linear. */
function hazeToward(air: Air, X: number, Z: number): Lin {
  const dx = X - air.cam.x;
  const dz = Z - air.cam.z;
  const len = Math.hypot(dx, dz) || 1;
  const c = Math.cos(0.015);
  return skyLin(air, [(dx / len) * c, 0.015, (dz / len) * c]);
}

/** Fraction of an object's own light that reaches the eye, 0–1. */
export function transmittance(air: Air, distanceM: number, heightM: number): number {
  const y0 = Math.max(0, air.cam.eye);
  const y1 = Math.max(0, heightM);
  // Mean density along the sight line through air that thins with height, with a thicker film at sea level.
  const expMean =
    Math.abs(y1 - y0) < 1 ? Math.exp(-y0 / HAZE_SCALE_M) : (HAZE_SCALE_M * (Math.exp(-y0 / HAZE_SCALE_M) - Math.exp(-y1 / HAZE_SCALE_M))) / (y1 - y0);
  const surface = 1 + air.seaHaze * 1.5 * (Math.abs(y1 - y0) < 1 ? Math.exp(-y0 / 60) : (60 * (Math.exp(-y0 / 60) - Math.exp(-y1 / 60))) / (y1 - y0));
  return Math.exp((-distanceM / air.visibilityM) * expMean * surface);
}

/** A world-space color seen from the camera: faded toward the haze at its bearing. */
export function aerial(air: Air, color: Lin, X: number, Y: number, Z: number): Lin {
  const d = Math.hypot(X - air.cam.x, Y - air.cam.eye, Z - air.cam.z);
  return mixLin(hazeToward(air, X, Z), color, transmittance(air, d, Y));
}

/** CSS color for a linear color. */
export function css(c: readonly number[], alpha = 1): string {
  return rgba(fromLin(c), alpha);
}
