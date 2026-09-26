import type { PierSpec, SceneComposition } from '../theme/beaches';
import { hex, mix, rgba, scale, type Rgb } from './color';
import { bearingTo, LANDMARKS, type Landmark } from './landmarks';
import { paletteFor, type Palette } from './palette';

/*
 * The hero scene: a view from the sand out to sea, drawn on one canvas.
 *
 * Geometry is a pinhole camera a few meters up the beach looking out to sea, so waves, the pier, and
 * the horizon all share one perspective: y = horizon + f·(eyeHeight − height)/distance. Distances
 * are scaled so the ocean fills about a third of the frame at any aspect ratio.
 *
 * It's atmospheric data visualization, so the conditions drive it:
 *   swell size       → wave height, where waves break, how far the whitewater runs up the sand
 *   swell period     → spacing and pace of the lines
 *   wind             → surface chop and whitecaps; offshore wind blows spray back off the lips
 *   tide             → where the waterline sits on the sand
 *   sun, cloud, fog  → sky, light, sun glitter, stars
 * Every input eases toward its new value, so a data refresh or a beach switch reads as the same scene
 * changing, not a cut. The beach-specific parts (pier, horizon landmarks) cross-fade.
 */

export interface SceneParams {
  /** Identity of the composition (the beach id). Changing it cross-fades pier and landmarks. */
  key: string;
  lat: number;
  lon: number;
  facingDeg: number;
  composition: SceneComposition;
  sunElevationDeg: number;
  sunAzimuthDeg: number;
  /** 0–1 */
  cloudCover: number;
  /** 0–1 */
  fog: number;
  /** 0–1 */
  rain: number;
  surfFaceFt: number;
  periodS: number;
  windMph: number;
  /** -1 straight onshore … 1 straight offshore. */
  windOffshore: number;
  /** 0 at the day's low tide, 1 at its high. */
  tideNorm: number;
}

const EASED = [
  'sunElevationDeg',
  'sunAzimuthDeg',
  'cloudCover',
  'fog',
  'rain',
  'surfFaceFt',
  'periodS',
  'windMph',
  'windOffshore',
  'tideNorm',
  'facingDeg',
  'warmth',
  'mist',
  'yawDeg',
] as const;
type Eased = (typeof EASED)[number];

interface Layer {
  key: string;
  lat: number;
  lon: number;
  composition: SceneComposition;
  alpha: number;
  target: 0 | 1;
}

interface Cloud {
  x: number;
  y: number;
  scale: number;
  speed: number;
  puffs: { dx: number; dy: number; r: number }[];
  canvas: HTMLCanvasElement | null;
}

interface Swash {
  born: number;
  runup: number;
  seed: number;
}

interface Whitecap {
  born: number;
  life: number;
  u: number;
  v: number;
  size: number;
}

interface Flock {
  born: number;
  duration: number;
  direction: 1 | -1;
  y: number;
  birds: { dx: number; dy: number; phase: number; size: number }[];
}

/** Eye height above the waterline, m. A little up the berm. */
const EYE_M = 6;
const TAU_S = 1.1;

/** Deterministic 0–1 noise from an integer. */
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export class OceanRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private maxDpr = 2;
  private cur: Record<Eased, number> | null = null;
  private target: Record<Eased, number> | null = null;
  private params: SceneParams | null = null;
  private layers: Layer[] = [];
  private time = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  private visible = true;
  private pointer = { x: 0, y: 0 };
  private parallax = { x: 0, y: 0 };
  private crestPhase = 0;
  private lastArrived = 0;
  private swashes: Swash[] = [];
  private wetReach = 0;
  private whitecaps: Whitecap[] = [];
  private flock: Flock | null = null;
  private nextFlock = 6;
  private clouds: Cloud[] = [];
  private cloudKey = '';
  private stars: { x: number; y: number; r: number; phase: number }[] = [];
  private slowFrames = 0;
  private readonly reducedMotion: boolean;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    options: { reducedMotion: boolean },
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    this.reducedMotion = options.reducedMotion;
    for (let i = 0; i < 110; i++) {
      this.stars.push({ x: hash(i * 3.1), y: hash(i * 7.7) ** 1.4, r: 0.4 + hash(i * 1.3) * 0.9, phase: hash(i) * 6.28 });
    }
    for (let i = 0; i < 9; i++) this.clouds.push(this.makeCloud(i));
  }

  setParams(params: SceneParams): void {
    const values: Record<Eased, number> = {
      sunElevationDeg: params.sunElevationDeg,
      sunAzimuthDeg: params.sunAzimuthDeg,
      cloudCover: params.cloudCover,
      fog: params.fog,
      rain: params.rain,
      surfFaceFt: params.surfFaceFt,
      periodS: params.periodS,
      windMph: params.windMph,
      windOffshore: params.windOffshore,
      tideNorm: params.tideNorm,
      facingDeg: params.facingDeg,
      warmth: params.composition.warmth,
      mist: params.composition.mist,
      yawDeg: params.composition.yawDeg,
    };
    this.target = values;
    const firstParams = !this.cur;
    if (!this.cur || this.reducedMotion) this.cur = { ...values };
    // Open mid-cycle, with sets already rolling in and water on the sand, rather than on a still frame.
    if (firstParams) for (let i = 0; i < 110; i++) this.step(0.1);

    const top = this.layers[this.layers.length - 1];
    if (!top || top.key !== params.key) {
      for (const layer of this.layers) layer.target = 0;
      const first = this.layers.length === 0 || this.reducedMotion;
      this.layers.push({
        key: params.key,
        lat: params.lat,
        lon: params.lon,
        composition: params.composition,
        alpha: first ? 1 : 0,
        target: 1,
      });
      if (this.reducedMotion) this.layers = this.layers.slice(-1);
    }
    this.params = params;
    if (!this.running) this.draw();
  }

  resize(width: number, height: number, devicePixelRatio: number): void {
    this.w = Math.max(1, width);
    this.h = Math.max(1, height);
    // Cap the backing store: a 4K canvas at 2x is a lot of pixels to fill 60 times a second.
    const budget = 3_600_000 / (this.w * this.h);
    this.dpr = Math.max(1, Math.min(devicePixelRatio, this.maxDpr, Math.sqrt(budget)));
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.cloudKey = '';
    this.draw();
  }

  /** Pointer position over the scene, -1…1 on each axis. */
  setPointer(x: number, y: number): void {
    this.pointer = { x, y };
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible && this.running) this.loop();
  }

  start(): void {
    if (this.reducedMotion) {
      this.time = 4;
      this.draw();
      return;
    }
    this.running = true;
    this.last = performance.now();
    this.loop();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private loop = (): void => {
    cancelAnimationFrame(this.raf);
    if (!this.running || !this.visible) return;
    this.raf = requestAnimationFrame((now) => {
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      const started = performance.now();
      this.step(dt);
      this.draw();
      this.adapt(performance.now() - started);
      this.loop();
    });
  };

  /** Drops resolution on slow devices instead of dropping frames. */
  private adapt(frameMs: number): void {
    this.slowFrames = frameMs > 14 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 1);
    if (this.slowFrames > 45 && this.maxDpr > 1) {
      this.maxDpr = Math.max(1, this.maxDpr - 0.5);
      this.slowFrames = 0;
      this.resize(this.w, this.h, window.devicePixelRatio || 1);
    }
  }

  private step(dt: number): void {
    this.time += dt;
    const k = 1 - Math.exp(-dt / TAU_S);
    if (this.cur && this.target) {
      for (const key of EASED) {
        if (key === 'sunAzimuthDeg' || key === 'facingDeg') {
          const d = ((this.target[key] - this.cur[key] + 540) % 360) - 180;
          this.cur[key] += d * k;
        } else {
          this.cur[key] += (this.target[key] - this.cur[key]) * k;
        }
      }
    }
    for (const layer of this.layers) {
      layer.alpha += (layer.target - layer.alpha) * (1 - Math.exp(-dt / 0.55));
    }
    this.layers = this.layers.filter((l) => l.target === 1 || l.alpha > 0.01);

    const pk = 1 - Math.exp(-dt / 0.9);
    this.parallax.x += (this.pointer.x - this.parallax.x) * pk;
    this.parallax.y += (this.pointer.y - this.parallax.y) * pk;

    // Waves: the phase counts how many crests have reached the beach.
    const period = this.cur?.periodS ?? 10;
    this.crestPhase += dt / Math.max(3.2, period * 0.52);
    const arrived = Math.floor(this.crestPhase);
    if (arrived > this.lastArrived) {
      const face = this.cur?.surfFaceFt ?? 1;
      this.swashes.push({ born: this.time, runup: 0.35 + Math.min(1.4, face * 0.22) * this.setSize(arrived), seed: arrived });
      this.lastArrived = arrived;
    }
    this.swashes = this.swashes.filter((s) => this.time - s.born < 6);

    const wind = this.cur?.windMph ?? 0;
    if (wind > 11 && Math.random() < dt * (wind - 11) * 0.9) {
      this.whitecaps.push({ born: this.time, life: 1.2 + Math.random() * 1.4, u: Math.random(), v: Math.random(), size: 0.6 + Math.random() * 0.8 });
    }
    this.whitecaps = this.whitecaps.filter((c) => this.time - c.born < c.life);

    for (const cloud of this.clouds) {
      cloud.x += (cloud.speed * dt) / 1400;
      if (cloud.x > 1.35) cloud.x = -0.35;
    }

    if (!this.flock && this.time > this.nextFlock) this.flock = this.makeFlock();
    if (this.flock && this.time - this.flock.born > this.flock.duration) {
      this.flock = null;
      this.nextFlock = this.time + 22 + Math.random() * 30;
    }
  }

  /** Swell comes in sets: every so often a few bigger waves. */
  private setSize(index: number): number {
    return 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(index * 0.83)) * (0.82 + 0.18 * hash(index));
  }

  private draw(): void {
    const p = this.cur;
    const params = this.params;
    if (!p || !params || this.w <= 1) return;
    const { ctx, w: W, h: H } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const camBearing = p.facingDeg + p.yawDeg;
    const relSun = ((p.sunAzimuthDeg - camBearing + 540) % 360) - 180;
    const pal = paletteFor({
      sunElevationDeg: p.sunElevationDeg,
      morning: p.sunAzimuthDeg < 180,
      cloudCover: p.cloudCover,
      fog: p.fog,
      rain: p.rain,
      warmth: p.warmth,
      sunInView: 1 - smooth(55, 95, Math.abs(relSun)),
    });

    // Layout: horizon a touch above center; the ocean takes about a third of the frame.
    const portrait = H > W;
    const horizon = H * (portrait ? 0.43 : 0.5) + this.parallax.y * 5;
    const f = Math.min(H * 1.25, W * (portrait ? 1.0 : 0.95));
    const band = H * (portrait ? 0.3 : 0.29);
    const shoreZ = (f * EYE_M) / band;
    const tideZ = shoreZ * (1 + 0.3 * (0.5 - p.tideNorm));
    const view: View = { W, H, f, horizon, shoreZ, tideZ, camBearing, px: this.parallax.x, pal, p };

    this.drawSky(view, relSun);
    this.drawClouds(view);
    for (const layer of this.layers) this.drawLandmarks(view, layer);
    this.drawOcean(view);
    this.drawGlitter(view, relSun);
    this.drawChop(view);
    this.drawCrests(view);
    this.drawWhitecaps(view);
    this.drawSand(view);
    this.drawSwash(view);
    for (const layer of this.layers) this.drawPier(view, layer);
    this.drawBirds(view);
    this.drawWeather(view);
  }

  // ─── Sky ──────────────────────────────────────────────────────────────────────────────────────

  private drawSky(v: View, relSun: number): void {
    const { ctx, } = this;
    const { W, horizon, pal, p, f } = v;
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, rgba(pal.zenith));
    sky.addColorStop(0.58, rgba(pal.mid));
    sky.addColorStop(1, rgba(pal.horizon));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, horizon + 2);

    if (pal.night > 0.02) {
      const twinkleClock = this.time * 1.3;
      for (const s of this.stars) {
        const y = s.y * horizon * 0.82;
        const a = pal.night * (1 - p.cloudCover * 0.9) * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(twinkleClock + s.phase))) * (1 - y / horizon);
        if (a < 0.02) continue;
        ctx.fillStyle = `rgba(235,242,255,${a.toFixed(3)})`;
        ctx.fillRect(s.x * W, y, s.r, s.r);
      }
    }

    // Sun: glow always (it lights the sky even from out of frame), disc when it's above the horizon.
    const sunX = W / 2 + f * Math.tan((Math.max(-80, Math.min(80, relSun)) * Math.PI) / 180) + v.px * 3;
    const sunY = horizon - f * Math.tan((p.sunElevationDeg * Math.PI) / 180) * 0.55;
    const glowStrength = clamp01(1 - Math.abs(p.sunElevationDeg) / 30) * 0.55 + 0.12 * clamp01(p.sunElevationDeg / 10);
    const glowAlpha = glowStrength * (1 - p.cloudCover * 0.55) * (p.sunElevationDeg > -12 ? 1 : 0);
    if (glowAlpha > 0.01) {
      const radius = W * 0.75;
      const glow = ctx.createRadialGradient(sunX, Math.max(sunY, -H_MARGIN), 0, sunX, Math.max(sunY, -H_MARGIN), radius);
      glow.addColorStop(0, rgba(pal.sunGlow, glowAlpha * 0.9));
      glow.addColorStop(0.25, rgba(pal.sunGlow, glowAlpha * 0.35));
      glow.addColorStop(1, rgba(pal.sunGlow, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, horizon + 2);
    }
    if (p.sunElevationDeg > -1.2 && Math.abs(relSun) < 75 && sunY > -40) {
      const r = Math.max(9, W * 0.011);
      const disc = clamp01(1 - p.cloudCover * 0.85) * clamp01((p.sunElevationDeg + 1.2) / 1.5);
      if (disc > 0.02) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, W, horizon);
        ctx.clip();
        const g = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, r * 3.2);
        g.addColorStop(0, rgba(mix(pal.sunGlow, hex('#ffffff'), 0.7), disc));
        g.addColorStop(0.3, rgba(pal.sunGlow, disc * 0.95));
        g.addColorStop(0.34, rgba(pal.sunGlow, disc * 0.35));
        g.addColorStop(1, rgba(pal.sunGlow, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(sunX, sunY, r * 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  private makeCloud(i: number): Cloud {
    // Cumulus-ish: a row of puffs, biggest in the middle, domed on top and flat along the base.
    const count = 7 + Math.floor(hash(i + 40) * 7);
    const puffs = Array.from({ length: count }, (_, j) => {
      const t = count === 1 ? 0.5 : j / (count - 1);
      const body = Math.sin(t * Math.PI);
      return {
        dx: (t - 0.5) * 2.4 + (hash(i * 13 + j) - 0.5) * 0.3,
        dy: -body * (0.25 + hash(i * 17 + j * 3) * 0.25),
        r: 0.28 + body * 0.42 + hash(i * 19 + j * 7) * 0.18,
      };
    });
    return {
      x: hash(i * 5.3) * 1.6 - 0.3,
      y: 0.14 + hash(i * 2.9) * 0.58,
      scale: 0.6 + hash(i * 8.1) * 0.8,
      speed: 3 + hash(i * 4.4) * 6,
      puffs,
      canvas: null,
    };
  }

  /** Clouds are soft sprites, re-rendered only when their lighting changes. */
  private drawClouds(v: View): void {
    const { pal, p, W, horizon } = v;
    const count = Math.round(p.cloudCover * 9 + (p.cloudCover > 0.08 ? 1 : 0));
    if (count === 0) return;
    const key = `${pal.cloudLit.map((c) => Math.round(c / 12)).join()}|${pal.cloudShade.map((c) => Math.round(c / 12)).join()}|${Math.round(W / 50)}`;
    if (key !== this.cloudKey) {
      this.cloudKey = key;
      for (const cloud of this.clouds) cloud.canvas = this.renderCloud(cloud, pal, W);
    }
    const { ctx } = this;
    for (let i = 0; i < Math.min(count, this.clouds.length); i++) {
      const cloud = this.clouds[i]!;
      if (!cloud.canvas) continue;
      // Clouds nearer the horizon are farther away: smaller, hazier.
      const depth = cloud.y;
      const alpha = clamp01(0.5 + p.cloudCover * 0.5) * (i < count - 1 ? 1 : 0.55) * (1 - depth * 0.35);
      ctx.globalAlpha = alpha;
      const size = 1 - depth * 0.45;
      const cw = (cloud.canvas.width / this.dpr) * size;
      const ch = (cloud.canvas.height / this.dpr) * size;
      const x = cloud.x * W - cw / 2 + v.px * (4 + (1 - depth) * 4);
      const y = cloud.y * horizon * 0.86 - ch / 2;
      ctx.drawImage(cloud.canvas, x, y, cw, ch);
    }
    ctx.globalAlpha = 1;
  }

  private renderCloud(cloud: Cloud, pal: Palette, W: number): HTMLCanvasElement {
    const unit = (W / 13) * cloud.scale;
    // Room for every puff: centers reach ±1.35 units, radii up to 0.9, tops lift another 0.8.
    const cw = unit * 5;
    const ch = unit * 2.3;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(cw * this.dpr);
    canvas.height = Math.ceil(ch * this.dpr);
    const c = canvas.getContext('2d')!;
    c.scale(this.dpr, this.dpr);
    const baseY = unit * 1.85;
    const puff = (x: number, y: number, r: number, color: Rgb, alpha: number) => {
      const g = c.createRadialGradient(x, y - r * 0.15, 0, x, y, r);
      g.addColorStop(0, rgba(color, alpha));
      g.addColorStop(0.62, rgba(color, alpha * 0.82));
      g.addColorStop(1, rgba(color, 0));
      c.fillStyle = g;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    };
    // Shaded body first, then sunlit tops offset upward.
    for (const p of cloud.puffs) puff(cw / 2 + p.dx * unit, baseY + p.dy * unit, p.r * unit, pal.cloudShade, 0.8);
    for (const p of cloud.puffs) puff(cw / 2 + p.dx * unit, baseY + p.dy * unit - p.r * unit * 0.28, p.r * unit * 0.82, pal.cloudLit, 0.72);
    // Flatten the base: fade everything out just below it.
    c.globalCompositeOperation = 'destination-out';
    const base = c.createLinearGradient(0, baseY - unit * 0.08, 0, baseY + unit * 0.3);
    base.addColorStop(0, 'rgba(0,0,0,0)');
    base.addColorStop(1, 'rgba(0,0,0,1)');
    c.fillStyle = base;
    c.fillRect(0, baseY - unit * 0.08, cw, ch);
    c.globalCompositeOperation = 'source-over';
    return canvas;
  }

  // ─── Horizon landmarks ────────────────────────────────────────────────────────────────────────

  private drawLandmarks(v: View, layer: Layer): void {
    if (layer.alpha < 0.01) return;
    const { ctx } = this;
    const { W, f, horizon, pal, p } = v;
    const camBearing = v.p.facingDeg + layer.composition.yawDeg;
    const toX = (bearing: number) => {
      const rel = ((bearing - camBearing + 540) % 360) - 180;
      return Math.abs(rel) > 80 ? null : W / 2 + f * Math.tan((rel * Math.PI) / 180) + v.px * 7;
    };
    const exaggerate = 2.6;

    for (const mark of LANDMARKS) {
      const projected = mark.points.map((pt) => {
        const { bearingDeg, distanceKm } = bearingTo(layer.lat, layer.lon, pt.lat, pt.lon);
        const x = toX(bearingDeg);
        return { x, distanceKm, heightPx: f * Math.tan(Math.atan(pt.heightKm / distanceKm)) * exaggerate };
      });
      if (projected.some((pt) => pt.x === null)) continue;
      const xs = projected.map((pt) => pt.x!);
      if (Math.max(...xs) < -20 || Math.min(...xs) > W + 20) continue;
      const distance = projected.reduce((sum, pt) => sum + pt.distanceKm, 0) / projected.length;
      if (distance > 90 || distance < 0.5) continue;

      const haze = clamp01(distance / 75 + p.mist * 0.35 + p.fog * 0.85 + p.cloudCover * 0.12);
      ctx.globalAlpha = layer.alpha;
      if (mark.kind === 'ridge') this.drawRidge(projected as { x: number; heightPx: number }[], mix(pal.farLand, pal.horizon, haze), horizon);
      else if (mark.kind === 'platform') this.drawPlatform(v, xs[0]!, distance, haze, mark);
      else this.drawBreakwater(v, projected as { x: number; distanceKm: number }[], haze);
      ctx.globalAlpha = 1;
    }
  }

  private drawRidge(points: { x: number; heightPx: number }[], color: Rgb, horizon: number): void {
    const { ctx } = this;
    ctx.fillStyle = rgba(color);
    ctx.beginPath();
    ctx.moveTo(points[0]!.x, horizon + 1);
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const mx = (a.x + b.x) / 2;
      const my = horizon - (a.heightPx + b.heightPx) / 2;
      ctx.quadraticCurveTo(a.x, horizon - a.heightPx, mx, my);
    }
    const last = points[points.length - 1]!;
    ctx.lineTo(last.x, horizon - last.heightPx);
    ctx.lineTo(last.x, horizon + 1);
    ctx.closePath();
    ctx.fill();
  }

  private drawPlatform(v: View, x: number, distanceKm: number, haze: number, mark: Landmark): void {
    const { ctx } = this;
    const { f, pal, horizon } = v;
    const s = Math.max(4, ((f * 0.06) / distanceKm) * 2.2);
    const base = horizon + (f * EYE_M) / (distanceKm * 1000) * 0.9;
    ctx.fillStyle = rgba(mix(pal.silhouette, pal.horizon, haze * 0.75));
    ctx.fillRect(x - s * 0.55, base - s * 0.5, s * 0.08, s * 0.5);
    ctx.fillRect(x + s * 0.47, base - s * 0.5, s * 0.08, s * 0.5);
    ctx.fillRect(x - s * 0.7, base - s * 0.62, s * 1.4, s * 0.14);
    ctx.fillRect(x - s * 0.5, base - s * 0.85, s * 0.7, s * 0.24);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.28, base - s * 0.62);
    ctx.lineTo(x + s * 0.4, base - s * 1.45);
    ctx.lineTo(x + s * 0.52, base - s * 0.62);
    ctx.fill();
    if (pal.night > 0.2) {
      // Platforms stay lit all night.
      const blink = 0.6 + 0.4 * Math.sin(this.time * 1.6 + mark.id.length);
      this.glowDot(x + s * 0.4, base - s * 1.45, 2.2, hex('#ff6a5a'), pal.night * blink);
      this.glowDot(x - s * 0.3, base - s * 0.7, 2, hex('#ffd9a0'), pal.night * 0.8);
      this.glowDot(x + s * 0.1, base - s * 0.72, 1.6, hex('#ffd9a0'), pal.night * 0.7);
    }
  }

  private drawBreakwater(v: View, points: { x: number; distanceKm: number }[], haze: number): void {
    const { ctx } = this;
    const { f, pal, horizon, p } = v;
    const y = (d: number) => horizon + ((f * EYE_M) / (d * 1000)) * 0.9;
    ctx.strokeStyle = rgba(mix(pal.silhouette, pal.horizon, haze * 0.6));
    ctx.lineCap = 'round';
    ctx.beginPath();
    points.forEach((pt, i) => {
      ctx.lineWidth = Math.max(1.2, 9 / pt.distanceKm);
      if (i === 0) ctx.moveTo(pt.x, y(pt.distanceKm) - 1);
      else ctx.lineTo(pt.x, y(pt.distanceKm) - 1);
    });
    ctx.stroke();
    // Swell breaking on the rocks.
    if (p.surfFaceFt > 0.8 && pal.light > 0.15) {
      for (let i = 0; i < 24; i++) {
        const t = hash(i * 9.1);
        const a = points[0]!;
        const b = points[points.length - 1]!;
        const flicker = 0.5 + 0.5 * Math.sin(this.time * (0.8 + hash(i) * 1.2) + i);
        if (flicker < 0.55) continue;
        const x = a.x + (b.x - a.x) * t;
        const d = a.distanceKm + (b.distanceKm - a.distanceKm) * t;
        ctx.fillStyle = rgba(pal.foam, 0.35 * flicker * pal.light);
        ctx.fillRect(x, y(d) - 2.5, 2 + hash(i * 3) * 3, 1.2);
      }
    }
  }

  // ─── Water ────────────────────────────────────────────────────────────────────────────────────

  private yAt(v: View, z: number, heightM = 0): number {
    return v.horizon + (v.f * (EYE_M - heightM)) / z;
  }

  /** Nearer things shift more with the pointer. */
  private shiftAt(v: View, z: number): number {
    return v.px * (8 + 18 * clamp01(v.shoreZ / z));
  }

  private drawOcean(v: View): void {
    const { ctx } = this;
    const { W, horizon, pal } = v;
    const shoreY = this.yAt(v, v.tideZ);
    const g = ctx.createLinearGradient(0, horizon, 0, shoreY);
    g.addColorStop(0, rgba(mix(pal.horizon, pal.waterFar, 0.55)));
    g.addColorStop(0.035, rgba(pal.waterFar));
    g.addColorStop(0.45, rgba(mix(pal.waterFar, pal.waterNear, 0.7)));
    g.addColorStop(0.82, rgba(pal.waterNear));
    g.addColorStop(1, rgba(pal.waterShallow));
    ctx.fillStyle = g;
    ctx.fillRect(0, horizon, W, shoreY - horizon + 1);
    // A soft sheen along the horizon.
    const sheen = ctx.createLinearGradient(0, horizon, 0, horizon + 18);
    sheen.addColorStop(0, rgba(pal.horizon, 0.35 * (0.3 + 0.7 * pal.light)));
    sheen.addColorStop(1, rgba(pal.horizon, 0));
    ctx.fillStyle = sheen;
    ctx.fillRect(0, horizon, W, 18);
  }

  private drawGlitter(v: View, relSun: number): void {
    const { pal, p, W, horizon, f } = v;
    if (pal.glitter < 0.02) return;
    const { ctx } = this;
    const shoreY = this.yAt(v, v.tideZ);
    const band = shoreY - horizon;
    const sunX = W / 2 + f * Math.tan((Math.max(-70, Math.min(70, relSun)) * Math.PI) / 180);
    // Low sun: a long streak from the horizon. High sun: a broad patch closer in.
    const center = clamp01(p.sunElevationDeg / 45);
    const rough = clamp01(0.25 + p.windMph / 22);
    const tick = Math.floor(this.time * 9);
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 190; i++) {
      const u = hash(i * 1.7);
      const depth = center < 0.15 ? u ** 1.6 : clamp01(center + (u - 0.5) * 0.8);
      const y = horizon + band * depth;
      const spread = W * (0.012 + 0.2 * depth ** 1.2) * (0.6 + rough);
      const x = sunX + (hash(i * 4.3) - 0.5) * 2 * spread * (0.4 + 0.6 * hash(i * 2.1)) + this.shiftAt(v, v.shoreZ / Math.max(0.05, depth));
      if (x < -10 || x > W + 10) continue;
      const on = hash(i * 13 + tick * (1 + (i % 3))) > 0.5;
      if (!on) continue;
      const a = pal.glitter * (0.25 + 0.75 * hash(i * 9.9)) * (1 - depth * 0.35);
      const len = 1.5 + 9 * depth * hash(i * 5.5);
      ctx.fillStyle = rgba(mix(pal.sunGlow, hex('#ffffff'), 0.5), a);
      ctx.fillRect(x - len / 2, y, len, 0.8 + depth * 1.4);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Surface texture: short glints and shadows whose density follows the wind. */
  private drawChop(v: View): void {
    const { ctx } = this;
    const { pal, p, W } = v;
    const chop = clamp01(0.18 + p.windMph / 24);
    const count = Math.round(70 + 180 * chop);
    const drift = this.time * (4 + p.windMph * 0.6);
    for (let i = 0; i < count; i++) {
      const u = hash(i * 2.3);
      const z = v.tideZ * 1.15 * Math.pow(55, u);
      const y = this.yAt(v, z) + Math.sin(this.time * 1.4 + i) * (v.f / z) * 0.05;
      const len = Math.max(1, (v.f / z) * (0.5 + chop * 1.4) * (0.5 + hash(i * 7.1)));
      const x = ((hash(i * 3.7) * (W + 80) + drift * (0.4 + hash(i)) * (v.shoreZ / z)) % (W + 80)) - 40 + this.shiftAt(v, z);
      const light = i % 2 === 0;
      const a = (light ? 0.12 : 0.1) * (0.4 + 0.6 * chop) * (0.5 + 0.5 * Math.sin(this.time * (1 + hash(i) * 2) + i)) * (0.4 + 0.6 * pal.light);
      if (a < 0.01) continue;
      ctx.fillStyle = light ? rgba(mix(pal.horizon, pal.foam, 0.3), a) : rgba(scale(pal.waterNear, 0.6), a * 1.2);
      ctx.fillRect(x, y, len, Math.max(0.6, len * 0.08));
    }
  }

  private drawCrests(v: View): void {
    const { ctx } = this;
    const { W, pal, p } = v;
    const face = Math.max(0.15, p.surfFaceFt);
    // Longer-period swell arrives in wider-spaced lines; bigger surf breaks farther out.
    const spacing = v.shoreZ * (0.3 + p.periodS * 0.022);
    const breakZ = v.tideZ * (1.55 + Math.min(1.6, face * 0.13));
    const waveScale = 2.0; // reads better than true scale at hero size
    const offshore = p.windOffshore;
    const first = Math.floor(this.crestPhase) + 1;
    const chunk = W > 900 ? 12 : 9;

    for (let n = 34; n >= 0; n--) {
      const k = first + n;
      const z = v.tideZ + (k - this.crestPhase) * spacing;
      if (z > v.shoreZ * 70) continue;
      const set = this.setSize(k);
      const shoal = 1 + 0.9 * smooth(breakZ + spacing * 3, breakZ, z);
      const ampM = face * 0.3048 * 0.5 * set * shoal * waveScale;
      const fade = clamp01((v.shoreZ * 70 - z) / (v.shoreZ * 50));
      const broken = smooth(breakZ, breakZ - spacing * 0.6, z);
      const boreStart = breakZ - spacing * 0.6;
      const bore = z < boreStart ? clamp01((z - v.tideZ) / (boreStart - v.tideZ)) : 1;
      const baseY = this.yAt(v, z);
      const lift = (v.f * ampM) / z;
      const wob = (v.f / z) * (0.18 + ampM * 0.3);
      const shift = this.shiftAt(v, z);
      const phase = k * 1.7;
      const crestY = (x: number) =>
        baseY - lift + wob * (Math.sin(x * (6.28 / (W * 0.62)) + phase + this.time * 0.22) * 0.7 + Math.sin(x * (6.28 / (W * 0.21)) + phase * 1.9 - this.time * 0.35) * 0.3);

      if (z > v.shoreZ * 9) {
        // Far lines: a hairline of reflected sky.
        ctx.strokeStyle = rgba(mix(pal.waterFar, pal.horizon, 0.5), 0.35 * fade * (0.5 + set * 0.5));
        ctx.lineWidth = Math.max(0.5, Math.min(1.2, (v.f / z) * 0.25));
        ctx.beginPath();
        for (let x = -chunk; x <= W + chunk; x += chunk * 2) {
          if (x === -chunk) ctx.moveTo(x + shift, crestY(x));
          else ctx.lineTo(x + shift, crestY(x));
        }
        ctx.stroke();
        continue;
      }

      // The face: lit crest fading into the darker trough in front of it.
      const faceH = lift * 1.25 + (v.f / z) * 0.25;
      const g = ctx.createLinearGradient(0, baseY - lift - wob, 0, baseY + faceH * 0.45);
      g.addColorStop(0, rgba(mix(pal.waterFar, pal.horizon, 0.45), 0.55 * fade));
      g.addColorStop(0.35, rgba(mix(pal.waterNear, pal.waterShallow, 0.5), 0.7 * fade));
      g.addColorStop(1, rgba(pal.waterNear, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      for (let x = -chunk; x <= W + chunk; x += chunk) ctx.lineTo(x + shift, crestY(x));
      for (let x = W + chunk; x >= -chunk; x -= chunk) ctx.lineTo(x + shift, crestY(x) + faceH);
      ctx.closePath();
      ctx.fill();

      if (broken <= 0.01) {
        ctx.strokeStyle = rgba(mix(pal.horizon, pal.foam, 0.4), 0.3 * fade);
        ctx.lineWidth = Math.max(0.6, (v.f / z) * 0.06);
        ctx.beginPath();
        for (let x = -chunk; x <= W + chunk; x += chunk) ctx.lineTo(x + shift, crestY(x));
        ctx.stroke();
        continue;
      }

      // Whitewater. Peaks break first; sections join as the wave comes in. Crisp at the lip, fading
      // into aerated water below it.
      const foamDepth = (v.f / z) * (0.2 + ampM * 0.36) * (0.45 + 0.55 * bore);
      const sectionAt = (x: number) => {
        const s = 0.5 + 0.5 * Math.sin(x * (6.28 / (W * 0.37)) + k * 2.3 + (breakZ - z) * 0.05);
        return clamp01(broken * 2.1 - (1 - smooth(0.25, 0.75, s)));
      };
      const lipY = (x: number) => crestY(x) - sectionAt(x) * lift * 0.22;
      const underY = (x: number) =>
        crestY(x) + sectionAt(x) * foamDepth * (0.8 + 0.2 * Math.sin(x * 0.017 + k * 5) + 0.08 * Math.sin(x * 0.061 + this.time * 0.5));
      const foamAlpha = (0.6 + 0.35 * bore) * (0.45 + 0.55 * pal.light) * fade;
      const top = baseY - lift * 1.3;
      const foamGradient = ctx.createLinearGradient(0, top, 0, baseY + foamDepth);
      foamGradient.addColorStop(0, rgba(pal.foam, foamAlpha));
      foamGradient.addColorStop(0.45, rgba(pal.foam, foamAlpha * 0.85));
      foamGradient.addColorStop(1, rgba(pal.foam, foamAlpha * 0.08));
      ctx.fillStyle = foamGradient;
      ctx.beginPath();
      for (let x = -chunk; x <= W + chunk; x += chunk) ctx.lineTo(x + shift, lipY(x));
      for (let x = W + chunk; x >= -chunk; x -= chunk) ctx.lineTo(x + shift, underY(x));
      ctx.closePath();
      ctx.fill();

      // Bubbles and streaks in the whitewater.
      ctx.fillStyle = rgba(mix(pal.foam, hex('#ffffff'), 0.5), foamAlpha * 0.55);
      for (let j = 0; j < 70; j++) {
        const x = hash(j * 3.1 + k * 7.7) * W;
        const e = sectionAt(x);
        if (e < 0.2) continue;
        const y = crestY(x) + hash(j * 5.9 + k) * foamDepth * e * 0.9;
        const len = 2 + hash(j * 2.2) * (v.f / z) * 0.5;
        ctx.fillRect(x + shift, y, len, Math.max(0.8, (v.f / z) * 0.05));
      }

      // Lace left behind the bore.
      if (bore < 0.95) {
        const laceY = this.yAt(v, z + spacing * 0.35);
        ctx.strokeStyle = rgba(pal.foam, 0.14 * (0.4 + 0.6 * pal.light) * fade);
        ctx.lineWidth = Math.max(0.8, (v.f / z) * 0.09);
        ctx.setLineDash([2, 5, 1, 9, 3, 7]);
        ctx.beginPath();
        for (let x = -chunk; x <= W + chunk; x += chunk) ctx.lineTo(x + shift, laceY + wob * Math.sin(x * 0.02 + k));
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Offshore wind feathers spray back off the lip.
      if (offshore > 0.25 && p.windMph > 5 && broken < 0.9) {
        const strength = offshore * Math.min(1, p.windMph / 14) * (0.4 + 0.6 * pal.light);
        ctx.strokeStyle = rgba(pal.foam, 0.28 * strength * fade);
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let j = 0; j < 36; j++) {
          const x = hash(j * 7.3 + k) * W;
          if (sectionAt(x) < 0.15) continue;
          const t = (this.time * 0.9 + hash(j + k * 3)) % 1;
          const y0 = crestY(x) - lift * 0.2;
          ctx.moveTo(x + shift + t * 6, y0 - t * lift * 1.6);
          ctx.lineTo(x + shift + t * 9, y0 - t * lift * 1.6 - 3 - lift * 0.4);
        }
        ctx.stroke();
      }
    }
  }

  private drawWhitecaps(v: View): void {
    const { ctx } = this;
    const { W, pal } = v;
    for (const cap of this.whitecaps) {
      const age = (this.time - cap.born) / cap.life;
      const a = Math.sin(age * Math.PI) * 0.7 * (0.35 + 0.65 * pal.light);
      const z = v.shoreZ * (3 + cap.u ** 1.5 * 45);
      const y = this.yAt(v, z);
      const len = Math.max(1.5, (v.f / z) * 1.4 * cap.size);
      ctx.fillStyle = rgba(pal.foam, a);
      ctx.beginPath();
      ctx.ellipse(cap.v * W + this.shiftAt(v, z), y, len, Math.max(0.6, len * 0.22), 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ─── Beach ────────────────────────────────────────────────────────────────────────────────────

  private drawSand(v: View): void {
    const { ctx } = this;
    const { W, H, pal } = v;
    const shoreY = this.yAt(v, v.tideZ);
    const g = ctx.createLinearGradient(0, shoreY, 0, H);
    g.addColorStop(0, rgba(pal.wetSand));
    g.addColorStop(0.08, rgba(mix(pal.wetSand, pal.sand, 0.6)));
    g.addColorStop(0.3, rgba(pal.sand));
    g.addColorStop(1, rgba(pal.sandNear));
    ctx.fillStyle = g;
    ctx.fillRect(0, shoreY, W, H - shoreY);

    // Wet sand where the last few waves reached, darker and a little reflective.
    const reach = Math.max(0.02, this.wetReach);
    const wetY = this.yAt(v, v.tideZ * (1 - reach));
    const wet = ctx.createLinearGradient(0, shoreY, 0, wetY);
    wet.addColorStop(0, rgba(mix(pal.wetSand, pal.horizon, 0.18), 0.9));
    wet.addColorStop(1, rgba(pal.wetSand, 0));
    ctx.fillStyle = wet;
    ctx.fillRect(0, shoreY, W, wetY - shoreY + 1);

    // High-tide line: a faint wrack line of kelp at the top of the day's reach.
    const wrackY = this.yAt(v, v.shoreZ * 0.8);
    if (wrackY > shoreY + 2) {
      ctx.strokeStyle = rgba(scale(pal.sand, 0.55), 0.35);
      ctx.lineWidth = 1.2;
      ctx.setLineDash([1, 4, 3, 6, 2, 5]);
      ctx.beginPath();
      for (let x = 0; x <= W; x += 16) ctx.lineTo(x + v.px * 24, wrackY + Math.sin(x * 0.013) * 2.5);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Wind ripples in the dry sand.
    ctx.strokeStyle = rgba(scale(pal.sand, 0.8), 0.18);
    ctx.lineWidth = 1;
    for (let i = 1; i < 9; i++) {
      const z = v.tideZ * (0.85 - i * 0.085);
      if (z <= 0.6) break;
      const y = this.yAt(v, z);
      if (y > H) break;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 24) ctx.lineTo(x + v.px * 24, y + Math.sin(x * 0.02 + i * 2) * (1 + i * 0.4));
      ctx.stroke();
    }
  }

  private drawSwash(v: View): void {
    const { ctx } = this;
    const { W, pal } = v;
    const shoreY = this.yAt(v, v.tideZ);
    let reach = 0;
    for (const s of this.swashes) {
      const age = this.time - s.born;
      const advance = 1.7;
      const retreat = 2.8;
      const extent =
        age < advance ? s.runup * Math.sin(((age / advance) * Math.PI) / 2) : s.runup * (1 - smooth(0, retreat, age - advance));
      const life = age < advance ? 1 : 1 - smooth(0, retreat + 1, age - advance);
      reach = Math.max(reach, extent);
      if (life < 0.02) continue;
      const edgeZ = v.tideZ * (1 - Math.min(0.55, extent * 0.3));
      const edgeY = this.yAt(v, edgeZ);
      const shift = this.shiftAt(v, edgeZ);
      const wob = (y: number, x: number) => y + Math.sin(x * 0.011 + s.seed * 1.3) * (edgeY - shoreY) * 0.35 + Math.sin(x * 0.037 + s.seed) * 1.5;

      ctx.fillStyle = rgba(mix(pal.waterShallow, pal.horizon, 0.25), 0.38 * life);
      ctx.beginPath();
      ctx.moveTo(-10, shoreY - 1);
      for (let x = -10; x <= W + 10; x += 14) ctx.lineTo(x + shift, wob(edgeY, x));
      ctx.lineTo(W + 10, shoreY - 1);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = rgba(pal.foam, 0.75 * life * (0.45 + 0.55 * pal.light));
      ctx.lineWidth = age < advance ? 2.2 : 1.4;
      ctx.beginPath();
      for (let x = -10; x <= W + 10; x += 14) ctx.lineTo(x + shift, wob(edgeY, x));
      ctx.stroke();
    }
    this.wetReach = Math.max(reach * 0.3, this.wetReach * 0.995);
  }

  // ─── Pier ─────────────────────────────────────────────────────────────────────────────────────

  private drawPier(v: View, layer: Layer): void {
    const pier = layer.composition.pier;
    if (!pier || layer.alpha < 0.01) return;
    const { ctx } = this;
    const { W, H, f, pal } = v;
    // Narrow screens pull the pier in so it stays in frame.
    const offset = pier.offsetM * Math.min(1, Math.max(0.5, W / H));
    const vpX = W / 2 - f * Math.tan((layer.composition.yawDeg * Math.PI) / 180);
    const zScale = v.shoreZ / 25;
    const deck = pier.deckM;
    const half = pier.widthM / 2;
    const side = Math.sign(offset) || -1;
    const nearX = offset - side * half;
    const farX = offset + side * half;
    const zEnd = v.shoreZ + pier.lengthM * zScale;
    const proj = (x: number, y: number, z: number): [number, number] => [
      vpX + (f * x) / z + this.shiftAt(v, z),
      v.horizon + (f * (EYE_M - y)) / z,
    ];
    // Start where the pier enters the frame.
    let zStart = 4;
    while (zStart < zEnd && Math.abs(proj(nearX, deck, zStart)[0] - W / 2) > W * 0.62) zStart *= 1.08;

    ctx.globalAlpha = layer.alpha;
    const body = pal.silhouette;
    const under = scale(pal.silhouette, 0.72);
    const rim = mix(pal.silhouette, pal.horizon, 0.35);

    // Pilings, far to near so nearer ones overlap.
    const step = pier.pilingSpacingM * zScale;
    for (let z = zEnd - step * 0.5; z > zStart; z -= step) {
      for (const x of [farX, nearX, (nearX + farX) / 2]) {
        const [px, top] = proj(x, deck - 0.8, z);
        const [, bottom] = proj(x, -0.4, z);
        ctx.strokeStyle = rgba(x === nearX ? body : under);
        ctx.lineWidth = Math.max(0.6, (f * 0.42) / z);
        ctx.beginPath();
        ctx.moveTo(px, top);
        ctx.lineTo(px, bottom);
        ctx.stroke();
      }
      // Cross bracing on the near bents.
      if ((f * 0.42) / z > 1.6) {
        const [ax, ay] = proj(nearX, deck - 1, z);
        const [bx, by] = proj(nearX, 0.6, z + step);
        ctx.strokeStyle = rgba(under, 0.7);
        ctx.lineWidth = Math.max(0.5, (f * 0.16) / z);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }

    // Deck: underside, then the near fascia with a rim of sky light along the top.
    const quad = (pts: [number, number][], color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.closePath();
      ctx.fill();
    };
    quad([proj(nearX, deck - 0.9, zStart), proj(nearX, deck - 0.9, zEnd), proj(farX, deck - 0.9, zEnd), proj(farX, deck - 0.9, zStart)], rgba(under));
    quad([proj(nearX, deck, zStart), proj(nearX, deck, zEnd), proj(nearX, deck - 1, zEnd), proj(nearX, deck - 1, zStart)], rgba(body));
    ctx.strokeStyle = rgba(rim, 0.8);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(...proj(nearX, deck, zStart));
    ctx.lineTo(...proj(nearX, deck, zEnd));
    ctx.stroke();

    // Railing.
    ctx.strokeStyle = rgba(body);
    ctx.lineWidth = Math.max(0.6, (f * 0.06) / Math.max(zStart, 20));
    ctx.beginPath();
    ctx.moveTo(...proj(nearX, deck + 1.1, zStart));
    ctx.lineTo(...proj(nearX, deck + 1.1, zEnd));
    ctx.stroke();
    for (let z = zStart; z < zEnd; z += 3 * zScale * (z < v.shoreZ * 4 ? 1 : 3)) {
      const [x0, y0] = proj(nearX, deck, z);
      const [, y1] = proj(nearX, deck + 1.1, z);
      ctx.lineWidth = Math.max(0.4, (f * 0.05) / z);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0, y1);
      ctx.stroke();
    }

    // Lamp posts, lit at dusk and after dark, with their reflections on the water.
    const lampsOn = clamp01((0.55 - pal.light) * 3);
    for (let z = zStart + pier.lampSpacingM * zScale * 0.5; z < zEnd - 4; z += pier.lampSpacingM * zScale) {
      const [lx, ly0] = proj(nearX, deck, z);
      const [, ly1] = proj(nearX, deck + 4.2, z);
      ctx.strokeStyle = rgba(body);
      ctx.lineWidth = Math.max(0.5, (f * 0.12) / z);
      ctx.beginPath();
      ctx.moveTo(lx, ly0);
      ctx.lineTo(lx, ly1);
      ctx.stroke();
      if (lampsOn > 0.02) {
        this.glowDot(lx, ly1, Math.min(3.2, Math.max(1.2, (f * 0.35) / z)), hex('#ffd49a'), lampsOn);
        const waterY = proj(nearX, 0, z)[1];
        if (z > v.tideZ) this.reflection(lx, waterY, Math.max(8, (f * 3) / z), lampsOn * 0.5, z);
      }
    }

    if (pier.endBuilding) this.drawPierHouse(v, pier, proj, offset, zEnd, zScale, lampsOn);
    ctx.globalAlpha = 1;
  }

  private drawPierHouse(
    v: View,
    pier: PierSpec,
    proj: (x: number, y: number, z: number) => [number, number],
    offset: number,
    zEnd: number,
    zScale: number,
    lampsOn: number,
  ): void {
    const b = pier.endBuilding!;
    const { ctx } = this;
    const { pal } = v;
    const deck = pier.deckM;
    const side = Math.sign(offset) || -1;
    const nearX = offset - (side * b.widthM) / 2;
    const farX = offset + (side * b.widthM) / 2;
    const z0 = zEnd - b.depthM * zScale;
    const z1 = zEnd;
    const top = deck + b.heightM;
    const face = mix(pal.silhouette, pal.horizon, 0.12);
    const sideColor = scale(pal.silhouette, 0.9);
    const poly = (pts: [number, number][], color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.closePath();
      ctx.fill();
    };
    // Side wall facing us, then the front (shoreward) wall.
    poly([proj(nearX, deck, z0), proj(nearX, deck, z1), proj(nearX, top, z1), proj(nearX, top, z0)], rgba(sideColor));
    poly([proj(nearX, deck, z0), proj(farX, deck, z0), proj(farX, top, z0), proj(nearX, top, z0)], rgba(face));
    const midX = (nearX + farX) / 2;
    if (b.roof === 'gable') {
      poly([proj(nearX, top, z0), proj(farX, top, z0), proj(midX, top + b.heightM * 0.45, z0)], rgba(face));
      poly([proj(nearX, top, z0), proj(midX, top + b.heightM * 0.45, z0), proj(midX, top + b.heightM * 0.45, z1), proj(nearX, top, z1)], rgba(scale(pal.silhouette, 0.8)));
    } else if (b.roof === 'hip') {
      poly([proj(nearX, top, z0), proj(farX, top, z0), proj(midX, top + b.heightM * 0.35, (z0 + z1) / 2)], rgba(face));
    } else {
      poly([proj(nearX, top, z0), proj(farX, top, z0), proj(farX, top + 0.4, z0), proj(nearX, top + 0.4, z0)], rgba(scale(face, 0.85)));
    }
    if (lampsOn > 0.05) {
      for (let i = 0; i < 4; i++) {
        const t = (i + 0.5) / 4;
        const [wx, wy] = proj(nearX + (farX - nearX) * t, deck + b.heightM * 0.45, z0);
        this.glowDot(wx, wy, 1.4, hex('#ffcf8a'), lampsOn * 0.85);
      }
    }
  }

  private glowDot(x: number, y: number, r: number, color: Rgb, alpha: number): void {
    const { ctx } = this;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 6);
    g.addColorStop(0, rgba(mix(color, hex('#ffffff'), 0.5), alpha));
    g.addColorStop(0.18, rgba(color, alpha * 0.8));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r * 6, y - r * 6, r * 12, r * 12);
  }

  private reflection(x: number, y: number, length: number, alpha: number, seed: number): void {
    const { ctx } = this;
    for (let i = 0; i < 7; i++) {
      const t = i / 7;
      const wobble = Math.sin(this.time * 2.2 + i * 1.7 + seed) * (1 + t * 3);
      ctx.fillStyle = `rgba(255,208,150,${(alpha * (1 - t) * 0.8).toFixed(3)})`;
      ctx.fillRect(x - 1.5 - t * 2 + wobble, y + t * length, 3 + t * 4, 1);
    }
  }

  // ─── Life & weather ───────────────────────────────────────────────────────────────────────────

  private makeFlock(): Flock {
    const count = 3 + Math.floor(Math.random() * 4);
    return {
      born: this.time,
      duration: 26 + Math.random() * 10,
      direction: Math.random() < 0.5 ? 1 : -1,
      y: 0.55 + Math.random() * 0.3,
      birds: Array.from({ length: count }, (_, i) => ({
        dx: i * (0.035 + Math.random() * 0.01),
        dy: (Math.random() - 0.5) * 0.03 + i * 0.006,
        phase: Math.random() * 6,
        size: 0.9 + Math.random() * 0.25,
      })),
    };
  }

  /** Brown pelicans: a loose line gliding low over the water, a few wingbeats now and then. */
  private drawBirds(v: View): void {
    const flock = this.flock;
    if (!flock || v.pal.light < 0.12) return;
    const { ctx } = this;
    const { W, horizon, pal } = v;
    const progress = (this.time - flock.born) / flock.duration;
    const span = Math.max(9, W * 0.0105);
    ctx.strokeStyle = rgba(mix(pal.silhouette, pal.mid, 0.25), 0.85 * clamp01(pal.light * 2));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const bird of flock.birds) {
      const t = progress - bird.dx;
      const xRaw = flock.direction === 1 ? -0.1 + t * 1.25 : 1.1 - t * 1.25;
      if (xRaw < -0.1 || xRaw > 1.1) continue;
      const x = xRaw * W + v.px * 10;
      const y = horizon * (flock.y + bird.dy) + Math.sin(this.time * 0.7 + bird.phase) * 3;
      const cycle = (this.time + bird.phase) % 5;
      const flap = cycle < 1.4 ? Math.sin(cycle * 7.5) * 0.55 : 0.08;
      const s = span * bird.size;
      ctx.lineWidth = Math.max(1.2, s * 0.13);
      ctx.beginPath();
      ctx.moveTo(x - s, y - flap * s * 0.6 + s * 0.08);
      ctx.quadraticCurveTo(x - s * 0.45, y - s * 0.22 - flap * s * 0.3, x, y);
      ctx.quadraticCurveTo(x + s * 0.45, y - s * 0.22 - flap * s * 0.3, x + s, y - flap * s * 0.6 + s * 0.08);
      ctx.stroke();
    }
  }

  private drawWeather(v: View): void {
    const { ctx } = this;
    const { W, H, horizon, pal, p } = v;
    // Atmospheric depth: haze pooled on the horizon, thicker in fog and on misty beaches.
    const haze = clamp01(p.mist * 0.35 + p.fog * 0.7 + p.cloudCover * 0.1);
    if (haze > 0.02) {
      const g = ctx.createLinearGradient(0, horizon - H * 0.14, 0, horizon + H * 0.1);
      g.addColorStop(0, rgba(pal.horizon, 0));
      g.addColorStop(0.55, rgba(pal.horizon, haze * 0.75));
      g.addColorStop(1, rgba(pal.horizon, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, horizon - H * 0.14, W, H * 0.24);
    }
    if (p.rain > 0.03) {
      ctx.strokeStyle = rgba(mix(pal.horizon, hex('#ffffff'), 0.4), 0.18 * p.rain);
      ctx.lineWidth = 1;
      ctx.beginPath();
      const drops = Math.round(160 * p.rain);
      for (let i = 0; i < drops; i++) {
        const x = (hash(i * 3.3) * W + this.time * 60) % W;
        const y = (hash(i * 7.1) * H + this.time * (500 + hash(i) * 200)) % H;
        ctx.moveTo(x, y);
        ctx.lineTo(x - 3, y + 12);
      }
      ctx.stroke();
    }
    // A gentle vignette to seat the scene.
    const vignette = ctx.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.35, W / 2, H * 0.55, Math.max(W, H) * 0.85);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, `rgba(2,8,14,${(0.28 + pal.night * 0.2).toFixed(3)})`);
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
  }
}

const H_MARGIN = 200;

interface View {
  W: number;
  H: number;
  f: number;
  horizon: number;
  /** Distance to the waterline at mid tide, m. */
  shoreZ: number;
  /** Distance to the waterline now. */
  tideZ: number;
  camBearing: number;
  px: number;
  pal: Palette;
  p: Record<Eased, number>;
}
