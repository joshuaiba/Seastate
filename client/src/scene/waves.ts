import type { SurfCharacter } from './spec';

/*
 * The swell, as a function of place and time. The sea shader (seaShader.ts) evaluates the same formulas
 * per pixel; this copy answers the questions the 2D layer asks, like where the water is on a pile right
 * now, or how high a surfer sits.
 *
 * It's a small physical model, not a simulation:
 *   - Crests travel at the shallow-water wave speed √(g·depth) over a planar seabed, so they slow and
 *     bunch up as they come in. The travel time has a closed form, so any point's phase is exact.
 *   - Crests keep their alongshore wavenumber (Snell's law), so swell arriving at an angle bends to
 *     meet the beach nearly square by the time it breaks.
 *   - Height grows by Green's law (∝ depth^-¼) until the wave is 0.78 × the depth, then it breaks
 *     and the bore shrinks with the depth to the sand.
 *   - Each crest has its own height: sets come through every dozen waves, and sandbar peaks make it
 *     break in sections, so whitewater starts at the peaks and runs along the line.
 */

export const G = 9.81;
const TAU = Math.PI * 2;

/** Crests are counted mod this, so indices stay small enough to hash identically in float32. */
const CREST_WRAP = 4096;

/** The shader's hash12. */
function hash12(x: number, y: number): number {
  const fr = (v: number) => v - Math.floor(v);
  let a = fr(x * 0.1031);
  let b = fr(y * 0.1031);
  let c = fr(x * 0.1031);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d;
  b += d;
  c += d;
  return fr((a + b) * c);
}

/** The shader's value noise. */
function vnoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash12(ix, iy);
  const b = hash12(ix + 1, iy);
  const c = hash12(ix, iy + 1);
  const d = hash12(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Deterministic 0–1 noise, the same as the shader's hash11. */
export function hash11(p: number): number {
  let x = p * 0.1031;
  x -= Math.floor(x);
  x *= x + 33.33;
  x *= x + x;
  return x - Math.floor(x);
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface SeaInputs {
  /** Typical breaking face height, m. */
  breakHeightM: number;
  periodS: number;
  /** Swell arrival angle from the shore normal, degrees; negative arrives from the left. */
  swellAngleDeg: number;
  /** -1 onshore … 1 offshore. */
  windOffshore: number;
  windMph: number;
  /** Where the waterline sits now, m seaward of the mean-tide line. */
  waterlineM: number;
  nearshoreSlope: number;
  faceSlope: number;
  surf: SurfCharacter;
}

/** Everything the shader and the 2D layer need to evaluate the sea at one instant. */
export class Sea {
  omega = TAU / 12;
  /** Primary swell phase, 0–2π, and how many crests have passed at phase 0. */
  clock = 0;
  crestBase = 0;
  /** Alongshore phase slope, s per m (Snell's ray parameter). */
  p = 0;
  slope = 0.02;
  /** Bore depth offset expressed as distance, m: keeps the speed finite at the waterline. */
  z0 = 10;
  cDeep = 18;
  zDeep = 1000;
  waterline = 0;
  breakH = 1;
  gamma = 0.78;
  setLen = 11;
  peakiness = 0.3;
  peakSpacing = 100;
  shadow: SurfCharacter['shadow'] = null;
  /** Horizontal run-up of a typical wave, m, and how long the swash takes to climb and drain. */
  runupM = 5;
  swashUpS = 3;
  swashDownS = 4;
  foamLifeS = 7;
  /** Secondary swell: [kx, kz] wavenumber, its own clock, and amplitude. */
  k2: [number, number] = [0, 0.05];
  omega2 = TAU / 8;
  clock2 = 0;
  amp2 = 0;

  configure(i: SeaInputs): void {
    this.omega = TAU / Math.max(4, i.periodS);
    this.cDeep = G / this.omega;
    this.slope = i.nearshoreSlope;
    this.breakH = Math.max(0.05, i.breakHeightM);
    // Offshore wind holds a wave up so it breaks in shallower water; onshore knocks it over early.
    const wind = Math.min(1, i.windMph / 15);
    this.gamma = 0.78 + 0.1 * i.windOffshore * wind;
    this.z0 = (0.35 * this.breakH) / this.slope;
    this.zDeep = (this.cDeep * this.cDeep) / (G * this.slope);
    const angle = (Math.max(-55, Math.min(55, i.swellAngleDeg)) * Math.PI) / 180;
    this.p = Math.sin(angle) / this.cDeep;
    this.waterline = i.waterlineM;
    this.peakiness = i.surf.peakiness;
    this.peakSpacing = i.surf.peakSpacingM;
    this.shadow = i.surf.shadow;
    this.foamLifeS = i.surf.foamLifeS;

    // Run-up climbs higher with bigger, longer-period waves (Iribarren), and a steep face turns it
    // into a short, quick swash; a gentle face spreads it out.
    const vertical = this.breakH * (0.18 + 0.012 * Math.min(18, i.periodS));
    this.runupM = vertical / i.faceSlope;
    const climb = Math.sqrt((2 * vertical) / G) / i.faceSlope;
    this.swashUpS = Math.min(0.42 * i.periodS, Math.max(0.9, climb * 0.55));
    this.swashDownS = this.swashUpS * 1.45;

    // A weaker, shorter cross swell from a little to the other side, so the sea never repeats exactly.
    const t2 = Math.max(5, i.periodS * 0.62);
    this.omega2 = TAU / t2;
    const k2 = (this.omega2 * this.omega2) / G;
    const a2 = angle * -0.6 + 0.35;
    this.k2 = [-Math.sin(a2) * k2, -Math.cos(a2) * k2];
    this.amp2 = this.breakH * 0.1;
  }

  advance(dt: number): void {
    this.clock += this.omega * dt;
    while (this.clock >= TAU) {
      this.clock -= TAU;
      this.crestBase = (this.crestBase + 1) % CREST_WRAP;
    }
    this.clock2 = (this.clock2 + this.omega2 * dt) % TAU;
  }

  /** Seconds a crest takes to travel from `zl` metres out to the waterline. */
  travel(zl: number): number {
    const zz = Math.max(zl, 0) + this.z0;
    const k = 2 / Math.sqrt(G * this.slope);
    if (zz < this.zDeep) return k * (Math.sqrt(zz) - Math.sqrt(this.z0));
    return k * (Math.sqrt(this.zDeep) - Math.sqrt(this.z0)) + (zz - this.zDeep) / this.cDeep;
  }

  /** Phase of the primary swell, radians (not wrapped). The slow warp makes crests short-crested. */
  phase(X: number, Z: number): number {
    return this.clock + this.omega * (this.travel(Z - this.waterline) + this.p * X) + 2.2 * (vnoise(X / 260, Z / 260) - 0.5);
  }

  /** Relative height of crest `k` at alongshore position X: sets, sandbar peaks, sheltering. */
  crestGain(k: number, X: number): number {
    // Wave groups from two beats whose lengths don't divide, so sets come through irregularly, with
    // lulls between, and the sequence never repeats; each crest varies a little on its own too.
    const group = 0.5 + 0.5 * Math.sin((TAU * k) / this.setLen + 1.3);
    const beat = 0.5 + 0.5 * Math.sin((TAU * k) / (this.setLen * 1.73) + 4.1);
    const set = 0.55 + 0.5 * group * (0.55 + 0.45 * beat) + 0.18 * (hash11(k) - 0.5);
    // Sandbars stay put, with rip channels between them, so the same stretches break first every
    // time; each crest's own lumps shift the break around them a little.
    const lambda = this.peakSpacing;
    const bars = 0.6 * Math.sin((TAU * X) / lambda + 0.8) + 0.4 * Math.sin((TAU * X) / (lambda * 0.53) + 2.9);
    const lumps = Math.sin((TAU * X) / (lambda * 0.71) + k * 2.1);
    const peak = 1 + this.peakiness * 0.45 * (0.8 * bars + 0.35 * lumps);
    let shade = 1;
    if (this.shadow) {
      const s = this.shadow;
      shade = 1 - (1 - s.floor) * smoothstep(s.fromM, s.toM, s.side * X);
    }
    return (set / 0.8) * peak * shade;
  }

  /** Distance from the waterline at which crest k breaks at X, m. */
  breakDistance(k: number, X: number): number {
    return (this.breakH * this.crestGain(k, X)) / this.gamma / this.slope;
  }

  /** Amplitude (half height) of crest k at local distance zl from the waterline. */
  amplitude(k: number, X: number, zl: number): number {
    const h = this.breakH * this.crestGain(k, X);
    const zb = h / this.gamma / this.slope;
    if (zl >= zb) return 0.5 * h * Math.max(0.18, Math.min(1, Math.pow(zb / Math.max(zl, 1e-3), 0.25)));
    return 0.5 * h * Math.pow(Math.max(0, zl) / zb, 0.9);
  }

  /** Water surface height above the still water level at (X, Z), m. */
  elevation(X: number, Z: number): number {
    const zl = Z - this.waterline;
    const cycles = this.phase(X, Z) / TAU;
    const n = Math.floor(cycles);
    const u = cycles - n;
    const k = (this.crestBase + n) % CREST_WRAP;
    const aBehind = this.amplitude(k, X, zl);
    const aAhead = this.amplitude(k + 1, X, zl);
    const a = aBehind + (aAhead - aBehind) * smoothstep(0.25, 0.85, u);
    const zb = this.breakH / this.gamma / this.slope;
    const steep = smoothstep(zb * 4, zb, zl);
    const w = 0.5 + 0.5 * Math.cos(profileAngle(u, 0.5 - 0.2 * steep));
    const q = 1 + 2.4 * steep;
    const primary = a * (2 * Math.pow(w, q) - 1);
    const surfFade = smoothstep(0, zb * 1.5, zl);
    const secondary = this.amp2 * surfFade * Math.cos(this.k2[0] * X + this.k2[1] * Z + this.clock2);
    return primary + secondary;
  }

  /** Rough whitewater cover at (X, Z), 0–1: enough to put foam around a pile. */
  whitewater(X: number, Z: number): number {
    const zl = Z - this.waterline;
    if (zl < 0) return 0;
    const cycles = this.phase(X, Z) / TAU;
    const n = Math.floor(cycles);
    const u = cycles - n;
    const k = (this.crestBase + n) % CREST_WRAP;
    const period = TAU / this.omega;
    const brokeBehind = zl < this.breakDistance(k, X) ? 1 : 0;
    const brokeAhead = zl < this.breakDistance(k + 1, X) ? 1 : 0;
    const trail = brokeBehind * Math.exp((-u * period) / (this.foamLifeS * 0.5));
    const roller = brokeAhead * smoothstep(0.85, 1, u);
    return Math.min(1, trail + roller);
  }
}

/**
 * Where in its cycle a point is, as an angle for the wave profile: 0 at the crest behind, π in the
 * trough, 2π at the crest ahead. `front` is the fraction of a wavelength the shoreward face takes:
 * under 0.5 the face steepens toward breaking.
 */
function profileAngle(u: number, front: number): number {
  const back = 1 - front;
  return u < back ? (Math.PI * u) / back : Math.PI + (Math.PI * (u - back)) / front;
}
