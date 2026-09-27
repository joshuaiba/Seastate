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
 *   - Each crest has its own height: sets come through in irregular groups, and sandbars (fixed in
 *     place, with rip channels between) make it break in sections, so whitewater starts at the peaks
 *     and runs along the line.
 *   - Whitewater is material. A breaking crest sheds foam; the foam keeps the bore's momentum for a
 *     moment, then slows, drifts on the longshore current and fades over a couple of wave periods.
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

/** Foam's starting speed as a share of the bore's, and seconds for it to fall by e. The shader mirrors these. */
const FOAM_SURGE = 0.7;
const FOAM_SLOW_S = 2.8;

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
  /** How long the swash rests at the top of its run-up before it drains, s. */
  swashHoldS = 0.5;
  foamLifeS = 7;
  /** Longshore current through the surf zone, m/s, positive to the right. */
  currentMps = 0;
  /** Speed foam rides the backwash out past the waterline, m/s. */
  backwashMps = 0.5;
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
    this.swashHoldS = this.swashUpS * 0.18;
    // The return flow is fast on the face but has little left once it reaches the water.
    this.backwashMps = 0.25 * Math.sqrt(2 * G * vertical);

    // Waves breaking at an angle drive a current along the beach (Longuet-Higgins), toward the side
    // they travel to. Kept to the gentle end: it only carries foam.
    const cBreak = Math.sqrt(G * this.slope * (this.breakH / this.gamma / this.slope + this.z0));
    const sinBreak = this.p * cBreak;
    this.currentMps = -0.6 * 1.17 * Math.sqrt(G * this.breakH) * sinBreak * Math.sqrt(1 - sinBreak * sinBreak);

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
    // Once broken, the peaked crest collapses into a bore: a steeper front and a rounder top.
    const bore = smoothstep(zb, zb * 0.55, zl);
    const w = 0.5 + 0.5 * Math.cos(profileAngle(u, 0.5 - 0.2 * steep - 0.08 * bore));
    const q = 1 + 2.4 * steep - 1.1 * bore;
    const primary = a * (2 * Math.pow(w, q) - 1);
    const surfFade = smoothstep(0, zb * 1.5, zl);
    const secondary = this.amp2 * surfFade * Math.cos(this.k2[0] * X + this.k2[1] * Z + this.clock2);
    return primary + secondary;
  }

  /** Speed of a bore (or an unbroken crest) at local distance zl, m/s. */
  boreSpeed(zl: number): number {
    return Math.min(this.cDeep, Math.sqrt(G * this.slope * (Math.max(zl, 0) + this.z0)));
  }

  /** How hard crest k broke along this stretch, 0.5–1: some sections pitch and run white, others barely feather. */
  section(k: number, X: number): number {
    return 0.5 + 0.5 * smoothstep(0.15, 0.8, vnoise(X / 45 + k * 7.13, k * 0.37));
  }

  /**
   * Foam crest k sheds into the water at local distance zr, 0–1: none before it breaks, building over
   * the first metres of the break, then less as the bore spends its energy on the way in.
   */
  release(k: number, X: number, zr: number): number {
    const zb = this.breakDistance(k, X);
    const broke = smoothstep(zb * 1.02, zb * 0.86, zr);
    if (broke <= 0) return 0;
    const spent = Math.max(0, this.travel(zb) - this.travel(zr));
    const big = Math.min(1.4, Math.max(0.6, zb / (this.breakH / this.gamma / this.slope)));
    return Math.min(1, broke * (0.3 + 0.8 * this.section(k, X) * big * (0.25 + 0.75 * Math.exp(-spent / (this.foamLifeS * 1.3)))));
  }

  /**
   * Where the foam now at zl was shed, as a distance back out to sea (m), for a crest that passed here
   * `a` seconds ago. Foam shed at zr drifts D(τ) = V(1 − e^(−τ/slow)) + w·τ shoreward, where τ, its age,
   * is `a` plus the time the bore took from zr to here. D is concave and always slower than the bore,
   * so two Newton steps from below land on the root.
   */
  shedDistance(zl: number, a: number, V: number, w: number): number {
    const t0 = this.travel(zl);
    let d = V * (1 - Math.exp(-a / FOAM_SLOW_S)) + w * a;
    for (let i = 0; i < 2; i++) {
      const tau = a + this.travel(zl + d) - t0;
      const e = Math.exp(-tau / FOAM_SLOW_S);
      const g = V * (1 - e) + w * tau - d;
      const dg = ((V / FOAM_SLOW_S) * e + w) / this.boreSpeed(zl + d) - 1;
      d -= g / dg;
    }
    return Math.max(d, 0);
  }

  /** Shoreward speed of foam from crest k as it's shed at zl, times the slowing time: how far it can surge, m. */
  surge(k: number, X: number, zl: number): number {
    return FOAM_SURGE * this.boreSpeed(zl) * FOAM_SLOW_S * (0.55 + 0.45 * this.section(k, X));
  }

  /**
   * Whitewater cover at (X, Z), 0–1, averaged over the shader's foam texture: the roller on the face of
   * the crest coming in, and the foam the last two crests left behind. Enough to put foam around a pile.
   */
  whitewater(X: number, Z: number): number {
    const zl = Z - this.waterline;
    if (zl < 0) return 0;
    const cycles = this.phase(X, Z) / TAU;
    const n = Math.floor(cycles);
    const u = cycles - n;
    const period = TAU / this.omega;
    const k0 = (this.crestBase + n) % CREST_WRAP;

    // The roller, riding the face of the next crest once it has broken.
    const k1 = (k0 + 1) % CREST_WRAP;
    const toArrive = (1 - u) * period;
    const zb1 = this.breakDistance(k1, X);
    const spent = Math.max(0, this.travel(zb1) - this.travel(zl));
    const rollerS = Math.min(1.5, Math.max(0.5, 0.11 * period)) * (0.2 + 0.8 * smoothstep(0, 2.5, spent));
    let cover = this.release(k1, X, zl) * smoothstep(rollerS, rollerS * 0.5, toArrive) * 0.95;

    // What the last two crests shed, each patch drifting in and fading on its own clock.
    for (let j = 0; j < 2; j++) {
      const k = (k0 - j + CREST_WRAP) % CREST_WRAP;
      const a = (u + j) * period;
      if (zl > this.breakDistance(k, X) * 1.02) continue;
      const zr = zl + this.shedDistance(zl, a, this.surge(k, X, zl), 0);
      const tau = a + this.travel(zr) - this.travel(zl);
      const life = this.foamLifeS * (0.6 + 0.5 * this.section(k, X));
      const c = this.release(k, X, zr) * Math.exp(-tau / life) * smoothstep(2 * period, 1.5 * period, tau);
      cover = Math.max(cover, c * (0.6 + 0.35 * Math.exp(-tau / (0.5 * life))));
    }
    return Math.min(1, cover);
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
