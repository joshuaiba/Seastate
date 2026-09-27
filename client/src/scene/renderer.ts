import { css, makeAir, type Air } from './atmosphere';
import { directionOf, makeCamera, type Camera } from './camera';
import { addLin, hex, lit, rgba, scaleLin, toLin, type Lin } from './color';
import { ShaderPass } from './gl';
import { drawHorizon } from './horizon';
import { Life } from './life';
import { paletteFor, type Palette } from './palette';
import { Pier } from './pier';
import { MAX_LAMPS, SEA_FRAGMENT, SEA_VERTEX } from './seaShader';
import type { BeachScene } from './spec';
import { Sea } from './waves';

/*
 * The hero scene: a view from the beach out to sea, as one small world.
 *
 * Two canvases share one camera (camera.ts). Underneath, a WebGL shader draws everything that's a
 * surface: sky, sea and sand, with the swell, foam, swash and light computed per pixel. On top, a 2D
 * canvas draws everything that's a thing: distant land, clouds, the pier, boats, surfers, birds. Both
 * work in the same metres and the same light, so the pier's piles stand in the water the shader draws
 * and its lamps glint on it.
 *
 * Conditions drive it all, and every input eases toward its new value, so a data refresh reads as the
 * same place changing:
 *   swell height, period, direction → wave size and spacing, where and how they break, run-up
 *   wind speed and direction         → chop, whitecaps, glassy inshore water when offshore, cloud drift
 *   tide                             → where the waterline sits on the sand and where waves break
 *   sun, moon, cloud, fog, rain      → the light on everything, glitter, stars, visibility
 *
 * Switching beaches is a short move along the coast: the camera travels toward the new beach, the old
 * pier slides away into a brief thickening of the haze while the new one arrives, the horizon's
 * landmarks shift by real parallax, and the sea and weather carry straight through.
 */

export interface SceneParams {
  /** Identity of the place (the beach id). Changing it moves the camera there. */
  key: string;
  lat: number;
  lon: number;
  facingDeg: number;
  scene: BeachScene;
  sunElevationDeg: number;
  sunAzimuthDeg: number;
  moonElevationDeg: number;
  moonAzimuthDeg: number;
  /** Lit fraction of the moon, 0–1. */
  moonIllumination: number;
  /** 0–1 */
  cloudCover: number;
  /** 0–1 */
  fog: number;
  /** 0–1 */
  rain: number;
  surfFaceFt: number;
  periodS: number;
  /** Direction the dominant swell comes from, degrees true. */
  swellDirDeg: number;
  windMph: number;
  /** Direction the wind blows from, degrees true. */
  windDirDeg: number;
  /** -1 straight onshore … 1 straight offshore. */
  windOffshore: number;
  /** 0 at the day's low tide, 1 at its high. */
  tideNorm: number;
  tideFalling: boolean;
}

const EASED = [
  'sunElevationDeg',
  'sunAzimuthDeg',
  'moonElevationDeg',
  'moonAzimuthDeg',
  'moonIllumination',
  'cloudCover',
  'fog',
  'rain',
  'surfFaceFt',
  'periodS',
  'swellDirDeg',
  'windMph',
  'windDirDeg',
  'windOffshore',
  'tideNorm',
  'tideFalling',
] as const;
type Eased = (typeof EASED)[number];
const ANGLES = new Set<Eased>(['sunAzimuthDeg', 'moonAzimuthDeg', 'swellDirDeg', 'windDirDeg']);

interface Place {
  key: string;
  lat: number;
  lon: number;
  facingDeg: number;
  scene: BeachScene;
  pier: Pier | null;
}

/** Numbers of two places' specs, blended while moving between them. */
interface Blend {
  lat: number;
  lon: number;
  facingDeg: number;
  yawDeg: number;
  setbackM: number;
  seaBand: number;
  faceSlope: number;
  nearshoreSlope: number;
  bermM: number;
  tideRangeM: number;
  peakSpacingM: number;
  peakiness: number;
  foamLifeS: number;
  shadow: BeachScene['surf']['shadow'];
  deep: Lin;
  shallow: Lin;
  turbid: Lin;
  clarityM: number;
  visibilityKm: number;
  warmth: number;
  seaHaze: number;
}

const TAU_S = 1.1;
const MOVE_S = 0.85;
/** How far each place's pier and boats drift along the beach during a switch, m. */
const DOLLY_M = 7;
const RAD = Math.PI / 180;

const hashTime = (t: number) => t % 3600;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpAngle = (a: number, b: number, t: number) => a + ((((b - a) % 360) + 540) % 360 - 180) * t;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function specBlend(a: Place, b: Place, t: number): Blend {
  const A = a.scene;
  const B = b.scene;
  const lin = (x: string, y: string, k: number): Lin => {
    const p = toLin(hex(x));
    const q = toLin(hex(y));
    return [lerp(p[0], q[0], k), lerp(p[1], q[1], k), lerp(p[2], q[2], k)];
  };
  return {
    lat: lerp(a.lat, b.lat, t),
    lon: lerp(a.lon, b.lon, t),
    facingDeg: lerpAngle(a.facingDeg, b.facingDeg, t),
    yawDeg: lerp(A.camera.yawDeg, B.camera.yawDeg, t),
    setbackM: lerp(A.camera.setbackM, B.camera.setbackM, t),
    seaBand: lerp(A.camera.seaBand, B.camera.seaBand, t),
    faceSlope: lerp(A.shore.faceSlope, B.shore.faceSlope, t),
    nearshoreSlope: lerp(A.shore.nearshoreSlope, B.shore.nearshoreSlope, t),
    bermM: lerp(A.shore.bermM, B.shore.bermM, t),
    tideRangeM: lerp(A.shore.tideRangeM, B.shore.tideRangeM, t),
    peakSpacingM: lerp(A.surf.peakSpacingM, B.surf.peakSpacingM, t),
    peakiness: lerp(A.surf.peakiness, B.surf.peakiness, t),
    foamLifeS: lerp(A.surf.foamLifeS, B.surf.foamLifeS, t),
    shadow: t < 0.5 ? A.surf.shadow : B.surf.shadow,
    deep: lin(A.water.deep, B.water.deep, t),
    shallow: lin(A.water.shallow, B.water.shallow, t),
    turbid: lin(A.water.turbid, B.water.turbid, t),
    clarityM: lerp(A.water.clarityM, B.water.clarityM, t),
    visibilityKm: lerp(A.atmosphere.visibilityKm, B.atmosphere.visibilityKm, t),
    warmth: lerp(A.atmosphere.warmth, B.atmosphere.warmth, t),
    seaHaze: lerp(A.atmosphere.seaHaze, B.atmosphere.seaHaze, t),
  };
}

/** Quality steps: resolution of the sea layer relative to the screen, and shader detail. */
const LEVELS = [
  { sea: 1, detail: 1 },
  { sea: 0.8, detail: 1 },
  { sea: 0.66, detail: 0 },
  { sea: 0.5, detail: 0 },
];

export class OceanRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly pass: ShaderPass | null;
  private readonly sea = new Sea();
  /** How far the cloud decks have drifted on the wind, m. */
  private cloudDrift = { x: 0, z: 0, cx: 0, cz: 0 };
  private readonly life = new Life();
  private readonly lampBuffer = new Float32Array(MAX_LAMPS * 4);
  private w = 0;
  private h = 0;
  private dpr = 1;
  private level = 0;
  private cur: Record<Eased, number> | null = null;
  private target: Record<Eased, number> | null = null;
  private from: Place | null = null;
  private to: Place | null = null;
  private move = 1;
  private moveDir = 0;
  private time = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  private visible = true;
  private pointer = { x: 0, y: 0 };
  private parallax = { x: 0, y: 0 };
  private scroll = 0;
  private slowFrames = 0;
  private readonly reducedMotion: boolean;

  constructor(
    private readonly seaCanvas: HTMLCanvasElement,
    private readonly canvas: HTMLCanvasElement,
    options: { reducedMotion: boolean; coarse: boolean },
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    this.pass = ShaderPass.create(seaCanvas, SEA_VERTEX, SEA_FRAGMENT);
    this.reducedMotion = options.reducedMotion;
    // Phones and tablets start a notch down; everything adapts from there.
    this.level = options.coarse ? 1 : 0;
    // Open at a random moment in the day's swell, not always the same frame.
    this.time = 20 + Math.random() * 600;
  }

  setParams(params: SceneParams): void {
    const values = Object.fromEntries(
      EASED.map((k) => [k, k === 'tideFalling' ? (params.tideFalling ? 1 : 0) : params[k]]),
    ) as Record<Eased, number>;
    this.target = values;
    const first = !this.cur;
    if (!this.cur || this.reducedMotion) this.cur = { ...values };

    if (!this.to || this.to.key !== params.key) {
      const place: Place = {
        key: params.key,
        lat: params.lat,
        lon: params.lon,
        facingDeg: params.facingDeg,
        scene: params.scene,
        pier: params.scene.pier ? new Pier(params.scene.pier) : null,
      };
      if (this.to && !this.reducedMotion) {
        // Which way along the shore we're going decides which way the camera travels.
        const east = (place.lon - this.to.lon) * Math.cos(place.lat * RAD);
        const north = place.lat - this.to.lat;
        const right = (this.to.facingDeg + 90) * RAD;
        this.moveDir = Math.sign(east * Math.sin(right) + north * Math.cos(right)) || 1;
        this.from = this.to;
        this.move = 0;
      } else {
        this.from = null;
        this.move = 1;
      }
      this.to = place;
    } else {
      this.to.scene = params.scene;
    }
    if (first) {
      this.configureSea(0);
      // Start mid-cycle, with sets rolling in and water already on the sand.
      for (let i = 0; i < 40; i++) this.step(0.1);
    }
    if (!this.running) this.draw();
  }

  resize(width: number, height: number, devicePixelRatio: number): void {
    this.w = Math.max(1, width);
    this.h = Math.max(1, height);
    // Cap the 2D backing store: a 4K canvas at 2x is a lot of pixels to fill every frame.
    const budget = 3_600_000 / (this.w * this.h);
    this.dpr = Math.max(1, Math.min(devicePixelRatio, 2, Math.sqrt(budget)));
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.sizeSea(devicePixelRatio);
    this.draw();
  }

  private seaScale = 1;

  private sizeSea(devicePixelRatio: number): void {
    // The sea is soft enough to render below full resolution; the 2D layer keeps edges crisp.
    const budget = 1_800_000 / (this.w * this.h);
    this.seaScale = Math.max(0.35, Math.min(devicePixelRatio, 1.25, Math.sqrt(budget)) * LEVELS[this.level]!.sea);
    this.seaCanvas.width = Math.round(this.w * this.seaScale);
    this.seaCanvas.height = Math.round(this.h * this.seaScale);
  }

  /** Pointer position over the scene, -1…1 on each axis. */
  setPointer(x: number, y: number): void {
    this.pointer = { x, y };
  }

  /** Page scroll, px: the camera rises a little as the hero scrolls away. */
  setScroll(y: number): void {
    this.scroll = y;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible && this.running) {
      this.last = performance.now();
      this.loop();
    }
  }

  start(): void {
    if (this.reducedMotion) {
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
      const interval = now - this.last;
      const dt = Math.min(0.1, interval / 1000);
      this.last = now;
      this.step(dt);
      this.draw();
      this.adapt(interval);
      this.loop();
    });
  };

  /** Steps quality down on devices that can't hold the frame rate, rather than stuttering. */
  private adapt(intervalMs: number): void {
    this.slowFrames = intervalMs > 24 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 2);
    if (this.slowFrames > 50 && this.level < LEVELS.length - 1) {
      this.level++;
      this.slowFrames = 0;
      this.sizeSea(window.devicePixelRatio || 1);
    }
  }

  private step(dt: number): void {
    this.time += dt;
    const k = 1 - Math.exp(-dt / TAU_S);
    if (this.cur && this.target) {
      for (const key of EASED) {
        this.cur[key] = ANGLES.has(key) ? lerpAngle(this.cur[key], this.target[key], k) : lerp(this.cur[key], this.target[key], k);
      }
    }
    if (this.move < 1) {
      this.move = Math.min(1, this.move + dt / MOVE_S);
      if (this.move >= 1) this.from = null;
    }
    this.parallax.x += (this.pointer.x - this.parallax.x) * (1 - Math.exp(-dt / 1.2));
    this.parallax.y += (this.pointer.y - this.parallax.y) * (1 - Math.exp(-dt / 1.2));

    this.configureSea(dt);
    this.life.step(this.time);
    if (this.cur && this.to) {
      // Clouds ride the wind aloft, a bit faster than the breeze at the beach; cirrus faster still.
      // Drift is kept in the view's frame, so a switch of beach keeps the same sky.
      const [wx, , wz] = directionOf(this.to.facingDeg, this.cur.windDirDeg + 180, 0);
      const speed = Math.max(2.5, this.cur.windMph * 0.447 * 1.6);
      this.cloudDrift.x -= wx * speed * dt;
      this.cloudDrift.z -= wz * speed * dt;
      this.cloudDrift.cx -= wx * speed * 2.5 * dt;
      this.cloudDrift.cz -= wz * speed * 2.5 * dt;
    }
  }

  private blend(): Blend | null {
    if (!this.to) return null;
    const t = this.from ? easeInOut(this.move) : 1;
    return specBlend(this.from ?? this.to, this.to, t);
  }

  private configureSea(dt: number): void {
    const p = this.cur;
    const b = this.blend();
    if (!p || !b) return;
    const tideM = (p.tideNorm - 0.5) * b.tideRangeM;
    this.sea.configure({
      breakHeightM: Math.max(0.1, p.surfFaceFt) * 0.3048 * 1.25,
      periodS: p.periodS,
      swellAngleDeg: ((((p.swellDirDeg - b.facingDeg) % 360) + 540) % 360) - 180,
      windOffshore: p.windOffshore,
      windMph: p.windMph,
      waterlineM: -tideM / b.faceSlope,
      nearshoreSlope: b.nearshoreSlope,
      faceSlope: b.faceSlope,
      surf: { peakSpacingM: b.peakSpacingM, peakiness: b.peakiness, foamLifeS: b.foamLifeS, shadow: b.shadow },
    });
    this.sea.advance(dt);
  }

  private camera(b: Blend, dx = 0): Camera {
    const px = this.reducedMotion ? 0 : this.parallax.x;
    const py = this.reducedMotion ? 0 : this.parallax.y;
    // During a switch the camera lifts and eases back a little, like a crane move, then settles.
    const crane = this.from ? Math.sin(Math.PI * this.move) : 0;
    return makeCamera({
      W: this.w,
      H: this.h,
      facingDeg: b.facingDeg,
      yawDeg: b.yawDeg + px * 0.35,
      setbackM: b.setbackM + crane * 18,
      seaBand: b.seaBand,
      dx: dx + px * 0.9,
      dEye: -py * 0.3 + Math.min(4, this.scroll * 0.004) + crane * 3,
    });
  }

  private draw(): void {
    const p = this.cur;
    const b = this.blend();
    if (!p || !b || !this.to || this.w <= 1) return;
    const { ctx } = this;
    const move = this.from ? this.move : 1;
    const e = easeInOut(move);
    // A brief thickening of the haze carries the move.
    const pulse = this.from ? Math.sin(Math.PI * move) : 0;

    const cam = this.camera(b);
    const pal = paletteFor({
      sunElevationDeg: p.sunElevationDeg,
      morning: p.sunAzimuthDeg < 180,
      cloudCover: p.cloudCover,
      fog: p.fog,
      rain: p.rain,
      warmth: b.warmth,
    });
    const sunDir = directionOf(b.facingDeg, p.sunAzimuthDeg, p.sunElevationDeg);
    const moonDir = directionOf(b.facingDeg, p.moonAzimuthDeg, p.moonElevationDeg);
    const moonUp = smooth(-2, 10, p.moonElevationDeg);
    const moonStrength = 0.15 * p.moonIllumination * moonUp * (1 - p.cloudCover * 0.7) * pal.night;
    const moonLight: Lin = [0.55 * moonStrength, 0.62 * moonStrength, 0.8 * moonStrength];
    const visibilityM = b.visibilityKm * 1000 * (1 - p.fog * 0.93) * (1 - p.rain * 0.5) * (1 - 0.55 * pulse);
    const air = makeAir(cam, pal, sunDir, visibilityM, b.seaHaze);
    const tideM = (p.tideNorm - 0.5) * b.tideRangeM;
    const lampsOn = smooth(0.4, 0.12, pal.light);

    // The pier whose shadow, reflection and lamps the sea should know about, fading with it.
    const leaving = this.from !== null && move < 0.5;
    const primary = leaving ? this.from! : this.to;
    const primaryDx = leaving ? this.moveDir * DOLLY_M * e : this.from ? -this.moveDir * DOLLY_M * (1 - e) : 0;
    const primaryFade = !this.from ? 1 : leaving ? 1 - smooth(0.15, 0.55, move) : smooth(0.45, 0.9, move);

    if (this.pass && !this.pass.lost) {
      this.drawSea(cam, pal, b, p, sunDir, moonDir, moonLight, visibilityM, tideM, lampsOn, primary, primaryDx, primaryFade);
    }

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.pass) this.drawFallback(cam, pal);

    const night = pal.night;
    drawHorizon(ctx, {
      cam,
      air,
      lat: b.lat,
      lon: b.lon,
      sunLight: pal.sunLight,
      ambient: pal.ambient,
      moonLight,
      night: Math.max(night, lampsOn * 0.8),
      time: this.time,
      surfM: p.surfFaceFt * 0.3048,
      periodS: p.periodS,
      alpha: 1,
    });

    // Each place's own things: its pier, boats, surfers. The one we're leaving slides away into the
    // haze; the one we're arriving at comes in from the other side.
    const places: { place: Place; dx: number; alpha: number; haze: number }[] = [];
    if (this.from) {
      places.push({ place: this.from, dx: this.moveDir * DOLLY_M * e, alpha: 1 - smooth(0.15, 0.55, move), haze: pulse });
      places.push({ place: this.to, dx: -this.moveDir * DOLLY_M * (1 - e), alpha: smooth(0.45, 0.9, move), haze: pulse });
    } else {
      places.push({ place: this.to, dx: 0, alpha: 1, haze: 0 });
    }
    for (const { place, dx, alpha, haze } of places) {
      if (alpha < 0.01) continue;
      const pc = this.camera(b, dx);
      // Each place's own things recede into the haze as it thickens, farthest parts first.
      const pAir: Air = makeAir(pc, pal, sunDir, visibilityM * (1 - 0.85 * haze), b.seaHaze + haze);
      this.life.draw(ctx, {
        cam: pc,
        air: pAir,
        sea: this.sea,
        life: place.scene.life,
        tideM,
        sunLight: pal.sunLight,
        ambient: pal.ambient,
        daylight: pal.light,
        night,
        surfFt: p.surfFaceFt,
        time: this.time,
        alpha,
      });
      place.pier?.draw(ctx, {
        cam: pc,
        air: pAir,
        sea: this.sea,
        sunDir,
        sunLight: pal.sunLight,
        ambient: pal.ambient,
        moonLight,
        lampsOn,
        tideM,
        faceSlope: b.faceSlope,
        bermM: b.bermM,
        alpha,
      });
    }

    this.drawWeather(cam, pal, p);
  }

  private drawSea(
    cam: Camera,
    pal: Palette,
    b: Blend,
    p: Record<Eased, number>,
    sunDir: readonly [number, number, number],
    moonDir: readonly [number, number, number],
    moonLight: Lin,
    visibilityM: number,
    tideM: number,
    lampsOn: number,
    primary: Place,
    primaryDx: number,
    primaryFade: number,
  ): void {
    const pass = this.pass!;
    const sea = this.sea;
    const level = LEVELS[this.level]!;
    pass.set2('uView', this.w, this.h);
    pass.set1('uPxScale', this.seaScale);
    pass.set1('uF', cam.f);
    pass.set1('uHorizonY', cam.horizonY);
    pass.set3('uCam', [cam.x, cam.eye, cam.z]);
    pass.set2('uYaw', cam.sinYaw, cam.cosYaw);
    pass.set1('uTime', hashTime(this.time));
    pass.set1('uQuality', level.detail);

    const srgb = (c: readonly number[]) => [c[0]! / 255, c[1]! / 255, c[2]! / 255];
    pass.set3('uSkyZenith', srgb(pal.zenith));
    pass.set3('uSkyMid', srgb(pal.mid));
    pass.set3('uSkyHorizon', srgb(pal.horizon));
    pass.set3('uSunDir', sunDir);
    pass.set3('uSunGlow', scaleLin(toLin(pal.sunGlow), pal.glowStrength));
    pass.set3('uSunLight', pal.sunLight);
    pass.set1('uSunDisc', (1 - p.cloudCover * 0.85) * (1 - p.fog * 0.8) * smooth(-1.2, 0.4, p.sunElevationDeg));
    pass.set3('uMoonDir', moonDir);
    pass.set3('uMoonLight', moonLight);
    pass.set1('uMoonDisc', smooth(-0.8, 0.6, p.moonElevationDeg) * (1 - p.cloudCover * 0.8) * (1 - p.fog * 0.8) * (0.3 + 0.7 * pal.night));
    pass.set3('uAmbient', pal.ambient);
    pass.set1('uStars', pal.night * (1 - p.cloudCover * 0.9) * (1 - p.fog));
    pass.set1('uDiscRadius', 0.0085);
    pass.set1('uGolden', pal.golden);
    pass.set1('uVisibility', visibilityM);
    pass.set1('uSeaHaze', b.seaHaze);
    pass.set1('uRain', p.rain);
    // The deck lowers into a marine layer in fog; cirrus comes with some cloud but never covers much.
    const cover = Math.min(1, p.cloudCover + p.fog * 0.4);
    pass.set4('uCloudA', cover, lerp(1150, 420, p.fog), this.cloudDrift.x, this.cloudDrift.z);
    pass.set4('uCloudB', Math.min(0.5, Math.max(0, (p.cloudCover - 0.12) * 0.9)) * (1 - p.fog), this.cloudDrift.cx, this.cloudDrift.cz, smooth(-1.6, 0.5, p.sunElevationDeg));
    pass.set3('uCloudLit', toLin(pal.cloudLit));
    pass.set3('uCloudShade', toLin(pal.cloudShade));

    pass.set4('uSwellA', sea.omega, sea.clock, sea.p, sea.crestBase);
    pass.set4('uSwellB', sea.slope, sea.z0, sea.cDeep, sea.zDeep);
    pass.set4('uSwellC', sea.waterline, sea.breakH, sea.gamma, sea.setLen);
    pass.set4('uSwellD', sea.peakiness, sea.peakSpacing, sea.runupM, sea.foamLifeS);
    const sh = sea.shadow;
    pass.set4('uShadow', sh ? sh.side : 0, sh ? sh.fromM : 0, sh ? sh.toM : 1, sh ? sh.floor : 1);
    pass.set4('uSwash', sea.swashUpS, sea.swashDownS, b.faceSlope, b.bermM);
    pass.set4('uSecond', sea.k2[0], sea.k2[1], sea.clock2, sea.amp2);
    const [wx, , wz] = directionOf(b.facingDeg, p.windDirDeg + 180, 0);
    pass.set4('uWind', wx, wz, p.windMph * 0.447, p.windOffshore);
    const highWaterline = -(b.tideRangeM / 2) / b.faceSlope;
    pass.set4('uTide', tideM, highWaterline - sea.waterline, p.tideFalling > 0.5 ? 1 : 0, 0);

    pass.set3('uWaterDeep', b.deep);
    pass.set3('uWaterShallow', b.shallow);
    pass.set3('uWaterTurbid', b.turbid);
    pass.set1('uClarity', b.clarityM);
    pass.set3('uFoam', [0.86, 0.9, 0.92]);
    pass.set3('uSand', toLin(hex('#d8c3a0')));

    const pier = primary.pier;
    if (pier) {
      const fp = pier.footprint();
      const x = fp.x - primaryDx;
      pass.set4('uPierA', x, fp.z0, fp.z1, fp.halfWidth);
      pass.set4('uPierB', fp.deckY, fp.endZ, fp.endHalfLength, fp.endHalfWidth);
      pass.set1('uPierFade', primaryFade);
      pass.set3('uPierColor', lit(toLin(hex('#6a6660')), addLin(scaleLin(pal.ambient, 0.35), pal.sunLight, 0.08)));
      const lampCam = { ...cam, x: cam.x + primaryDx };
      const lamps = lampsOn > 0.02 ? pier.reflectingLamps(lampCam, tideM, MAX_LAMPS) : [];
      this.lampBuffer.fill(0);
      // Lamps look dimmer against a still-bright sky than they do in the dark.
      lamps.forEach((l, i) => this.lampBuffer.set([l.x - primaryDx, l.y, l.z, lampsOn * lampsOn * primaryFade], i * 4));
      pass.set4v('uLamps', this.lampBuffer);
      pass.set1('uLampCount', lamps.length);
    } else {
      pass.set4('uPierA', 0, 0, 0, 0);
      pass.set1('uLampCount', 0);
    }
    pass.set3('uLampColor', toLin(hex('#ffc488')));
    pass.draw(this.seaCanvas.width, this.seaCanvas.height);
  }

  /** Without WebGL: a plain sky, sea and beach so the page still has its hero. */
  private drawFallback(cam: Camera, pal: Palette): void {
    const { ctx } = this;
    const sky = ctx.createLinearGradient(0, 0, 0, cam.horizonY);
    sky.addColorStop(0, rgba(pal.zenith));
    sky.addColorStop(0.58, rgba(pal.mid));
    sky.addColorStop(1, rgba(pal.horizon));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, this.w, cam.horizonY);
    const shore = cam.horizonY + this.h * 0.3;
    ctx.fillStyle = css(lit(toLin(hex('#1a4a5c')), addLin(pal.ambient, pal.sunLight, 0.5)));
    ctx.fillRect(0, cam.horizonY, this.w, shore - cam.horizonY);
    ctx.fillStyle = css(lit(toLin(hex('#d8c3a0')), addLin(pal.ambient, pal.sunLight, 0.8)));
    ctx.fillRect(0, shore, this.w, this.h - shore);
  }

  private drawWeather(cam: Camera, pal: Palette, p: Record<Eased, number>): void {
    const { ctx } = this;
    const { W, H } = cam;
    if (p.rain > 0.03) {
      ctx.strokeStyle = rgba([200, 210, 220], 0.16 * p.rain * (0.4 + 0.6 * pal.light));
      ctx.lineWidth = 1;
      ctx.beginPath();
      const drops = Math.round(160 * p.rain);
      const slant = Math.max(-6, Math.min(6, p.windMph * 0.3));
      for (let i = 0; i < drops; i++) {
        const u = (i * 0.618034) % 1;
        const v = (i * 0.414214) % 1;
        const x = (u * W + this.time * 40 * Math.sign(slant)) % W;
        const y = (v * H + this.time * (520 + (i % 7) * 30)) % H;
        ctx.moveTo(x, y);
        ctx.lineTo(x - slant, y + 12);
      }
      ctx.stroke();
    }
    // A light vignette to seat the scene.
    const vignette = ctx.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.4, W / 2, H * 0.55, Math.max(W, H) * 0.85);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, `rgba(2,8,14,${(0.2 + pal.night * 0.15).toFixed(3)})`);
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
  }
}
