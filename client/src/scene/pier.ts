import { aerial, css, transmittance, type Air, type Vec3 } from './atmosphere';
import { NEAR, project, type Camera } from './camera';
import { addLin, hex, lit, scaleLin, toLin, type Lin } from './color';
import type { PierSpec } from './spec';
import { hash11, type Sea } from './waves';

/*
 * A pier built from its parts in world space and drawn through the scene camera.
 *
 * The structure is a list of stations along the pier: every bent, plus the corners of each platform so
 * octagons and diamonds keep their true outline. Between stations are deck segments (top, the fascia
 * facing the camera, railings on both edges); at each bent, a row of piles with a cap beam and, on a
 * timber pier, diagonal bracing. Lamps stand on the edges, and a building, if the pier has one, sits
 * inside its platform.
 *
 * Every part goes into one list sorted by its distance from the camera and is painted far to near.
 * That's what lets a lamp's glow sit at its own depth: rails, decks and walls in front of it cover it,
 * and ones behind it don't. Piles end at the live water surface from the swell model and collect foam
 * when whitewater runs through.
 */

export interface PierFrame {
  cam: Camera;
  air: Air;
  sea: Sea;
  sunDir: Vec3;
  /** Linear light. */
  sunLight: Lin;
  ambient: Lin;
  moonLight: Lin;
  /** 0–1: lamps switched on. */
  lampsOn: number;
  /** Water level, m above mean sea level. */
  tideM: number;
  faceSlope: number;
  bermM: number;
  /** Opacity, while the pier fades in or out during a switch of beach. */
  alpha: number;
}

interface Item {
  key: number;
  draw: () => void;
}

const LAMP_COLOR: Lin = toLin(hex('#ffc98a'));

let glowSprite: HTMLCanvasElement | null = null;

/** A soft light, drawn once and scaled for every lamp. */
function glow(): HTMLCanvasElement {
  if (glowSprite) return glowSprite;
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(255,244,222,1)');
  grad.addColorStop(0.08, 'rgba(255,226,180,0.95)');
  grad.addColorStop(0.22, 'rgba(255,196,130,0.35)');
  grad.addColorStop(0.55, 'rgba(255,170,100,0.08)');
  grad.addColorStop(1, 'rgba(255,160,90,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  glowSprite = c;
  return c;
}

export class Pier {
  private readonly stations: number[];
  private readonly deck: Lin;
  private readonly pile: Lin;
  private readonly rail: Lin;
  private readonly metal: Lin = toLin(hex('#3b4148'));
  private readonly people: { s: number; across: number; h: number }[];

  constructor(readonly spec: PierSpec) {
    const timber = spec.material === 'timber';
    this.deck = toLin(hex(timber ? '#8d7f6c' : '#b8b2a6'));
    this.pile = toLin(hex(timber ? '#6f6356' : '#a39d92'));
    this.rail = toLin(hex(timber ? '#9a8b76' : '#c9c4b8'));

    const s = new Set<number>();
    for (let v = 0; v <= spec.lengthM + 1e-6; v += spec.bents.spacingM) s.add(Math.round(v * 100) / 100);
    s.add(spec.lengthM);
    for (const p of spec.platforms) {
      const half = p.lengthM / 2;
      const keys = p.shape === 'octagon' ? [-half, -half * 0.42, half * 0.42, half] : p.shape === 'diamond' ? [-half, 0, half] : [-half, half];
      for (const k of keys) {
        const at = Math.min(spec.lengthM, Math.max(0, p.atM + k));
        s.add(Math.round(at * 100) / 100);
        s.add(Math.round((at - 0.01) * 100) / 100);
      }
    }
    this.stations = [...s].filter((v) => v >= 0 && v <= spec.lengthM).sort((a, b) => a - b);

    // A few people along the rails, fewer toward the end.
    this.people = Array.from({ length: 16 }, (_, i) => ({
      s: spec.lengthM * Math.pow(hash11(i * 7.3 + 1), 1.3),
      across: hash11(i * 3.1 + 2) < 0.5 ? -0.8 : 0.8,
      h: 1.55 + hash11(i * 5.9) * 0.3,
    }));
  }

  /** Half-width of the deck at `s` metres along, including platforms. */
  halfWidth(s: number): number {
    let hw = this.spec.widthM / 2;
    for (const p of this.spec.platforms) {
      const d = Math.abs(s - p.atM);
      const half = p.lengthM / 2;
      if (d > half) continue;
      if (p.shape === 'rect') hw = Math.max(hw, p.widthM / 2);
      else if (p.shape === 'diamond') hw = Math.max(hw, (p.widthM / 2) * (1 - d / half));
      else {
        const chamfer = half * 0.58;
        hw = Math.max(hw, p.widthM / 2 - Math.max(0, d - (half - chamfer)) * ((p.widthM / 2 - this.spec.widthM / 2) / chamfer));
      }
    }
    return hw;
  }

  deckY(s: number): number {
    const [a, b] = this.spec.deckM;
    return a + (b - a) * (s / this.spec.lengthM);
  }

  z(s: number): number {
    return this.spec.startM + s;
  }

  /** Where the deck casts its shadow and hides the sky, for the sea shader. */
  footprint(): { x: number; z0: number; z1: number; halfWidth: number; deckY: number; endZ: number; endHalfLength: number; endHalfWidth: number } {
    const end = [...this.spec.platforms].sort((a, b) => b.atM - a.atM)[0];
    return {
      x: this.spec.offsetM,
      z0: this.z(0),
      z1: this.z(this.spec.lengthM),
      halfWidth: this.spec.widthM / 2,
      deckY: this.deckY(this.spec.lengthM),
      endZ: end ? this.z(end.atM) : 0,
      endHalfLength: end ? end.lengthM / 2 : 0,
      endHalfWidth: end ? (end.shape === 'diamond' ? end.widthM * 0.36 : end.widthM / 2) : 0,
    };
  }

  /** Lamp positions in world space: [x, y, z] and which edge. */
  lamps(): { x: number; y: number; z: number; s: number }[] {
    const l = this.spec.lamps;
    if (!l) return [];
    const out: { x: number; y: number; z: number; s: number }[] = [];
    for (let s = l.spacingM * 0.5; s < this.spec.lengthM - 2; s += l.spacingM) {
      const hw = this.halfWidth(s) + l.outboardM;
      for (const side of [-1, 1]) out.push({ x: this.spec.offsetM + side * hw, y: this.deckY(s) + l.heightM, z: this.z(s), s });
    }
    return out;
  }

  /**
   * The lamps whose light can reach the water where the camera would see it reflected, nearest first.
   * A lamp on the far rail is hidden from that patch of water by the deck, so it gets no reflection.
   */
  reflectingLamps(cam: Camera, tideM: number, max: number): { x: number; y: number; z: number }[] {
    const result: { x: number; y: number; z: number; d: number }[] = [];
    for (const lamp of this.lamps()) {
      const h = lamp.y - tideM;
      const eye = cam.eye - tideM;
      const t = eye / (eye + h);
      const rx = cam.x + (lamp.x - cam.x) * t;
      const rz = cam.z + (lamp.z - cam.z) * t;
      // Where the ray from that water spot up to the lamp crosses the underside of the deck.
      const s = this.deckY(lamp.s) - this.spec.deckThicknessM - tideM;
      const u = s / h;
      const px = rx + (lamp.x - rx) * u;
      const pz = rz + (lamp.z - rz) * u;
      const along = pz - this.spec.startM;
      const blocked = along > 0 && along < this.spec.lengthM && Math.abs(px - this.spec.offsetM) < this.halfWidth(along) - 0.2;
      if (blocked) continue;
      result.push({ x: lamp.x, y: lamp.y, z: lamp.z, d: Math.hypot(lamp.x - cam.x, lamp.z - cam.z) });
    }
    return result.sort((a, b) => a.d - b.d).slice(0, max);
  }

  draw(ctx: CanvasRenderingContext2D, fr: PierFrame): void {
    const { cam, air } = fr;
    const spec = this.spec;
    const side = Math.sign(spec.offsetM - cam.x) || -1;
    const items: Item[] = [];
    const dist = (x: number, y: number, z: number) => Math.hypot(x - cam.x, y - cam.eye, z - cam.z);
    const P = (x: number, y: number, z: number) => project(cam, x, y, z);
    const visible = (z: number, x: number) => (x - cam.x) * cam.sinYaw + (z - cam.z) * cam.cosYaw > NEAR + 1;
    const px = (m: number, d: number) => (cam.f * m) / d;

    // Light on a face with normal n: sun, sky (a vertical face sees half of it), moon.
    const shadeFace = (albedo: Lin, n: Vec3, sky: number, sunShade = 1): Lin => {
      const sd = Math.max(0, n[0] * fr.sunDir[0] + n[1] * fr.sunDir[1] + n[2] * fr.sunDir[2]);
      const light = addLin(addLin(scaleLin(fr.ambient, sky), fr.sunLight, sd * sunShade), fr.moonLight, sky * 0.6);
      return lit(albedo, light);
    };
    const nearNormal: Vec3 = [-side, 0, 0];
    const lampWarm = (s: number): number => {
      // Lamplight on nearby structure at night, strongest right under a lamp.
      if (!spec.lamps || fr.lampsOn < 0.02) return 0;
      const k = (((s / spec.lamps.spacingM - 0.5) % 1) + 1) % 1;
      const d = Math.min(k, 1 - k) * spec.lamps.spacingM;
      return fr.lampsOn * (0.02 + 0.1 * Math.exp(-d / 3));
    };
    const withLamp = (c: Lin, s: number, k = 1): Lin => addLin(c, lit([0.6, 0.55, 0.5], LAMP_COLOR), lampWarm(s) * k);

    const sandY = (z: number) => Math.min(fr.bermM, fr.tideM + fr.faceSlope * (fr.sea.waterline - z));
    const waterline = fr.sea.waterline;

    // ── bents ──
    const bentS: number[] = [];
    for (let s = 0; s <= spec.lengthM + 1e-6; s += spec.bents.spacingM) bentS.push(s);
    for (const s of bentS) {
      const z = this.z(s);
      if (!visible(z, spec.offsetM)) continue;
      const hw = this.halfWidth(s);
      const count = Math.max(2, Math.round(spec.bents.piles * (hw / (spec.widthM / 2)) ** 0.7));
      const deckBottom = this.deckY(s) - spec.deckThicknessM;
      items.push({
        key: dist(spec.offsetM, deckBottom * 0.5, z),
        draw: () => {
          const xs = Array.from({ length: count }, (_, i) => spec.offsetM + side * hw * (1 - (2 * i) / (count - 1)));
          const d = dist(spec.offsetM, deckBottom * 0.5, z);
          const T = transmittance(air, d, 3);
          // Far to near across the bent.
          const bottoms: [number, number][] = [];
          const tops: [number, number][] = [];
          for (let i = 0; i < xs.length; i++) {
            const x = xs[i]!;
            const onSand = z < waterline;
            const water = onSand ? sandY(z) : fr.tideM + fr.sea.elevation(x, z);
            const [sx, top, depth] = P(x, deckBottom, z);
            const [, bottom] = P(x, water, z);
            const w = px(spec.bents.pileDiameterM, depth);
            const near = i === xs.length - 1;
            // Under the deck a pile is in shade; its lower part catches the sun from the open side.
            const lower = shadeFace(this.pile, nearNormal, near ? 0.55 : 0.3, near ? 1 : 0.35);
            const upper = shadeFace(this.pile, nearNormal, near ? 0.3 : 0.15, 0.15);
            const cLow = aerial(air, withLamp(lower, s, 0.15), x, water + 1, z);
            const cUp = aerial(air, withLamp(upper, s, 0.3), x, deckBottom - 1, z);
            tops.push([sx, top]);
            bottoms.push([sx, bottom]);
            if (w < 0.35) {
              ctx.strokeStyle = css(cLow, Math.max(0.15, w / 0.35) * 0.9);
              ctx.lineWidth = 0.6;
              ctx.beginPath();
              ctx.moveTo(sx, top);
              ctx.lineTo(sx, bottom);
              ctx.stroke();
            } else {
              const g = ctx.createLinearGradient(0, top, 0, bottom);
              g.addColorStop(0, css(cUp));
              g.addColorStop(0.45, css(cUp));
              g.addColorStop(1, css(cLow));
              ctx.fillStyle = g;
              ctx.fillRect(sx - w / 2, top, w, bottom - top);
              if (w > 3) {
                // Round piles: a lit flank toward the sun, a dark one away.
                const toward = fr.sunDir[0] * side < 0 ? -1 : 1;
                const flank = ctx.createLinearGradient(sx - w / 2, 0, sx + w / 2, 0);
                const k = Math.min(0.35, 0.5 * Math.hypot(fr.sunLight[0], fr.sunLight[1]));
                flank.addColorStop(toward > 0 ? 1 : 0, `rgba(255,248,235,${(k * 0.45).toFixed(3)})`);
                flank.addColorStop(0.5, 'rgba(0,0,0,0)');
                flank.addColorStop(toward > 0 ? 0 : 1, `rgba(0,0,0,${(0.28).toFixed(3)})`);
                ctx.fillStyle = flank;
                ctx.fillRect(sx - w / 2, top, w, bottom - top);
              }
            }
            // Whitewater wrapping the pile.
            if (!onSand && w > 0.4) {
              const foam = fr.sea.whitewater(x, z);
              if (foam > 0.08) {
                // Broken, not a ring: a few scraps of white banked against the seaward face.
                const fw = Math.max(1, w * 1.5);
                ctx.fillStyle = css(aerial(air, lit([0.85, 0.88, 0.9], addLin(fr.ambient, fr.sunLight, 0.8)), x, water, z), foam * 0.7 * T);
                for (let j = 0; j < 3; j++) {
                  const o = (hash11(i * 7 + j * 3 + s) - 0.5) * fw * 1.4;
                  const r = fw * (0.3 + 0.4 * hash11(j + s * 0.37));
                  ctx.beginPath();
                  ctx.ellipse(sx + o, bottom - 0.3, r, Math.max(0.5, r * 0.3), 0, 0, Math.PI * 2);
                  ctx.fill();
                }
              }
            }
          }
          // Cap beam across the bent.
          const [c0x, c0y] = P(xs[0]!, deckBottom, z);
          const [c1x, c1y] = P(xs[xs.length - 1]!, deckBottom, z);
          const capH = px(0.55, dist(spec.offsetM, deckBottom, z));
          if (capH > 0.5) {
            ctx.strokeStyle = css(aerial(air, withLamp(shadeFace(this.pile, nearNormal, 0.25, 0.2), s), spec.offsetM, deckBottom, z));
            ctx.lineWidth = capH;
            ctx.beginPath();
            ctx.moveTo(c0x, c0y + capH / 2);
            ctx.lineTo(c1x, c1y + capH / 2);
            ctx.stroke();
          }
          // Timber bents are braced corner to corner.
          if (spec.bents.braced && xs.length > 1 && px(0.2, d) > 0.4) {
            ctx.strokeStyle = css(aerial(air, shadeFace(this.pile, nearNormal, 0.25, 0.4), spec.offsetM, 2, z), 0.85);
            ctx.lineWidth = Math.max(0.5, px(0.18, d));
            ctx.beginPath();
            for (let i = 0; i < xs.length - 1; i++) {
              const [ax, ay] = tops[i]!;
              const [bx] = tops[i + 1]!;
              const lowY = ay + (Math.min(bottoms[i]![1], bottoms[i + 1]![1]) - ay) * 0.72;
              ctx.moveTo(ax, ay + 1);
              ctx.lineTo(bx, lowY);
              ctx.moveTo(bx, ay + 1);
              ctx.lineTo(ax, lowY);
            }
            ctx.stroke();
          }
        },
      });
    }

    // The building draws after the deck beneath it and before anything standing in front of it.
    const b = spec.building;
    const buildingKey = b ? dist(spec.offsetM - side * (b.widthM / 2), this.deckY(b.atM) + b.wallM / 2, this.z(b.atM)) + 0.05 : null;

    // ── deck segments, railings, people ──
    const st = this.stations;
    for (let i = 0; i < st.length - 1; i++) {
      const s0 = st[i]!;
      const s1 = st[i + 1]!;
      if (s1 - s0 < 0.02) continue;
      const z0 = this.z(s0);
      const z1 = this.z(s1);
      if (!visible(z1, spec.offsetM)) continue;
      // The nearest visible segment starts at the near plane.
      const sNear = cam.z + (NEAR + 1.5 - (spec.offsetM - cam.x) * cam.sinYaw) / cam.cosYaw - spec.startM;
      const clippedS0 = visible(z0, spec.offsetM) ? s0 : Math.min(s1 - 0.05, Math.max(s0, sNear));
      const sm = (clippedS0 + s1) / 2;
      const zm = this.z(sm);
      const hw0 = this.halfWidth(clippedS0);
      const hw1 = this.halfWidth(s1);
      const y0 = this.deckY(clippedS0);
      const y1 = this.deckY(s1);
      const zc0 = this.z(clippedS0);
      const nearX = (hw: number) => spec.offsetM - side * hw;
      const farX = (hw: number) => spec.offsetM + side * hw;
      const underBuilding = buildingKey !== null && spec.building && Math.abs(sm - spec.building.atM) < spec.building.depthM / 2 + 1;

      items.push({
        key: underBuilding ? Math.max(dist(spec.offsetM, y0, zm), buildingKey! + 0.02) : dist(spec.offsetM, y0, zm),
        draw: () => {
          const top = aerial(air, withLamp(shadeFace(this.deck, [0, 1, 0], 1), sm, 1.4), spec.offsetM, y0, zm);
          const fascia = aerial(air, withLamp(shadeFace(this.deck, nearNormal, 0.5), sm), nearX(hw0), y0 - 0.5, zm);
          // Deck top.
          const a = P(farX(hw0), y0, zc0);
          const b = P(farX(hw1), y1, z1);
          const c = P(nearX(hw1), y1, z1);
          const d = P(nearX(hw0), y0, zc0);
          ctx.fillStyle = css(top);
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
          ctx.lineTo(c[0], c[1]);
          ctx.lineTo(d[0], d[1]);
          ctx.closePath();
          ctx.fill();
          // The fascia facing us, with the deck's thickness.
          const e = P(nearX(hw1), y1 - spec.deckThicknessM, z1);
          const f = P(nearX(hw0), y0 - spec.deckThicknessM, zc0);
          ctx.fillStyle = css(fascia);
          ctx.beginPath();
          ctx.moveTo(d[0], d[1]);
          ctx.lineTo(c[0], c[1]);
          ctx.lineTo(e[0], e[1]);
          ctx.lineTo(f[0], f[1]);
          ctx.closePath();
          ctx.fill();
          // A joint line across the deck at each bent, where the eye can resolve it.
          if (px(1, dist(spec.offsetM, y0, zc0)) > 6 && Math.abs((clippedS0 / spec.bents.spacingM) % 1) < 0.01) {
            ctx.strokeStyle = css(scaleLin(top, 0.82), 0.6);
            ctx.lineWidth = 0.6;
            ctx.beginPath();
            ctx.moveTo(a[0], a[1]);
            ctx.lineTo(d[0], d[1]);
            ctx.stroke();
          }
          // Pools of lamplight on the deck at night.
          if (spec.lamps && fr.lampsOn > 0.05) {
            const k = (((sm / spec.lamps.spacingM - 0.5) % 1) + 1) % 1;
            if (Math.min(k, 1 - k) * spec.lamps.spacingM < (s1 - clippedS0) / 2 + 0.01) {
              for (const sgn of [-1, 1]) {
                const [lx, ly, ld] = P(spec.offsetM + sgn * this.halfWidth(sm) * 0.7, y0, zm);
                const r = px(4, ld);
                if (r < 1) continue;
                const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, r);
                g.addColorStop(0, `rgba(255,200,140,${(0.28 * fr.lampsOn * transmittance(air, ld, y0)).toFixed(3)})`);
                g.addColorStop(1, 'rgba(255,200,140,0)');
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.ellipse(lx, ly, r, r * Math.max(0.12, Math.abs((cam.eye - y0) / Math.max(ld, 1)) * 3), 0, 0, Math.PI * 2);
                ctx.fill();
              }
            }
          }
        },
      });

      // Railings: posts, top and mid rails. Far away they merge into a faint band.
      for (const which of ['far', 'near'] as const) {
        const X = which === 'far' ? farX : nearX;
        const xm = X(this.halfWidth(sm));
        items.push({
          key: dist(xm, y0 + 0.5, zm) - (which === 'near' ? 0.01 : -0.01),
          draw: () => {
            const h = spec.railing.heightM;
            const n: Vec3 = which === 'near' ? nearNormal : [side, 0, 0];
            const color = aerial(air, withLamp(shadeFace(this.rail, n, 0.55), sm), xm, y0 + h, zm);
            const p0 = P(X(hw0), y0 + h, zc0);
            const p1 = P(X(hw1), y1 + h, z1);
            const b0 = P(X(hw0), y0, zc0);
            const b1 = P(X(hw1), y1, z1);
            const dm = dist(xm, y0, zm);
            const lw = Math.max(0.5, px(0.12, dm));
            ctx.strokeStyle = css(color);
            ctx.lineWidth = lw;
            ctx.beginPath();
            ctx.moveTo(p0[0], p0[1]);
            ctx.lineTo(p1[0], p1[1]);
            const m0 = P(X(hw0), y0 + h * 0.5, zc0);
            const m1 = P(X(hw1), y1 + h * 0.5, z1);
            if (px(h, dm) > 3) {
              ctx.moveTo(m0[0], m0[1]);
              ctx.lineTo(m1[0], m1[1]);
            }
            ctx.stroke();
            const span = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
            const posts = Math.floor((s1 - clippedS0) / spec.railing.postSpacingM);
            if (posts > 0 && span / posts > 3) {
              ctx.lineWidth = Math.max(0.5, px(0.1, dm));
              ctx.beginPath();
              for (let j = 0; j <= posts; j++) {
                const t = j / posts;
                ctx.moveTo(b0[0] + (b1[0] - b0[0]) * t, b0[1] + (b1[1] - b0[1]) * t);
                ctx.lineTo(p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t);
              }
              ctx.stroke();
            } else {
              // Too fine to resolve: the balusters read as a thin veil.
              ctx.fillStyle = css(color, 0.35);
              ctx.beginPath();
              ctx.moveTo(b0[0], b0[1]);
              ctx.lineTo(b1[0], b1[1]);
              ctx.lineTo(p1[0], p1[1]);
              ctx.lineTo(p0[0], p0[1]);
              ctx.closePath();
              ctx.fill();
            }
          },
        });
      }
    }

    // People along the rails: scale, mostly. Fewer after dark.
    const light = Math.max(0.25, Math.min(1, fr.sunLight[1] * 3 + 0.2));
    for (let i = 0; i < this.people.length; i++) {
      const person = this.people[i]!;
      if (i / this.people.length > light) continue;
      const x = spec.offsetM + person.across * this.halfWidth(person.s) * 0.85;
      const z = this.z(person.s);
      if (!visible(z, x)) continue;
      const y = this.deckY(person.s);
      items.push({
        key: dist(x, y + 1, z) - 0.02,
        draw: () => {
          const [bx, by, d] = P(x, y, z);
          const hpx = px(person.h, d);
          if (hpx < 1.6) return;
          const color = aerial(air, shadeFace(toLin(hex('#3a3a40')), nearNormal, 0.5, 0.6), x, y + 1, z);
          ctx.fillStyle = css(color);
          const w = Math.max(0.8, hpx * 0.26);
          ctx.fillRect(bx - w / 2, by - hpx * 0.84, w, hpx * 0.84);
          ctx.beginPath();
          ctx.arc(bx, by - hpx * 0.9, Math.max(0.5, hpx * 0.1), 0, Math.PI * 2);
          ctx.fill();
        },
      });
    }

    // ── lamps ──
    const lampSpec = spec.lamps;
    if (lampSpec) {
      for (const lamp of this.lamps()) {
        if (!visible(lamp.z, lamp.x)) continue;
        items.push({
          key: dist(lamp.x, lamp.y - 1, lamp.z),
          draw: () => {
            const base = this.deckY(lamp.s);
            const [bx, by, d] = P(lamp.x, base, lamp.z);
            const [, ty] = P(lamp.x, lamp.y, lamp.z);
            const color = aerial(air, shadeFace(this.metal, nearNormal, 0.5, 0.7), lamp.x, lamp.y, lamp.z);
            const w = px(0.12, d);
            ctx.strokeStyle = css(color, Math.min(1, 0.35 + w));
            ctx.lineWidth = Math.max(0.5, w);
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.lineTo(bx, ty);
            ctx.stroke();
            const head = Math.max(0.7, px(0.35, d));
            ctx.fillStyle = css(color);
            ctx.fillRect(bx - head / 2, ty - head * 0.3, head, head * 0.6);
            if (fr.lampsOn > 0.02) {
              // Size and strength fall off with distance and through the haze; far lamps stay points.
              // A lamp is a small source: close up it has a modest halo, far off it's a point of light.
              const T = transmittance(air, d, lamp.y);
              const r = Math.max(1.3, px(0.8, d));
              const a = fr.lampsOn * T * Math.min(1, 0.55 + px(1, d) * 0.08);
              ctx.globalAlpha = Math.min(1, a) * ctx.globalAlpha;
              ctx.globalCompositeOperation = 'lighter';
              ctx.drawImage(glow(), bx - r * 2, ty - r * 2, r * 4, r * 4);
              ctx.globalCompositeOperation = 'source-over';
              ctx.globalAlpha = fr.alpha;
            }
          },
        });
      }
    }

    // ── building ──
    if (b && buildingKey !== null) {
      const zc = this.z(b.atM);
      const zf = zc - b.depthM / 2;
      const zb = zc + b.depthM / 2;
      const xn = spec.offsetM - side * (b.widthM / 2);
      const xf = spec.offsetM + side * (b.widthM / 2);
      const y0 = this.deckY(b.atM);
      const ye = y0 + b.wallM;
      const yr = ye + b.roofM;
      if (visible(zf, spec.offsetM)) {
        items.push({
          key: buildingKey,
          draw: () => {
            const wall = toLin(hex(b.wall));
            const roof = toLin(hex(b.roofColor));
            const poly = (pts: [number, number, number][], color: Lin, alpha = 1) => {
              ctx.fillStyle = css(color, alpha);
              ctx.beginPath();
              pts.forEach(([x, y, z], i) => {
                const [sx, sy] = P(x, y, z);
                if (i === 0) ctx.moveTo(sx, sy);
                else ctx.lineTo(sx, sy);
              });
              ctx.closePath();
              ctx.fill();
            };
            // Front wall (facing the shore) and the side wall facing the camera.
            const front = aerial(air, withLamp(shadeFace(wall, [0, 0, -1], 0.55), b.atM, 0.6), spec.offsetM, y0 + 2, zf);
            const sideC = aerial(air, withLamp(shadeFace(wall, nearNormal, 0.55), b.atM, 0.6), xn, y0 + 2, zc);
            poly([[xn, y0, zf], [xf, y0, zf], [xf, ye, zf], [xn, ye, zf]], front);
            poly([[xn, y0, zf], [xn, y0, zb], [xn, ye, zb], [xn, ye, zf]], sideC);
            // Windows along the side and front: dark by day, warm at night.
            const d = dist(xn, ye, zc);
            if (px(1, d) > 1.2) {
              const lit = fr.lampsOn;
              const winDay: Lin = scaleLin(sideC, 0.45);
              const winNight: Lin = addLin(scaleLin(sideC, 0.3), LAMP_COLOR, 0.9 * transmittance(air, d, ye));
              const win = addLin(scaleLin(winDay, 1 - lit), winNight, lit);
              const rows = [[xn, zf + 1.2, zb - 1.2, 'side'] as const, [xf, xn, zf, 'front'] as const];
              for (const row of rows) {
                const n = 4;
                for (let j = 0; j < n; j++) {
                  const t0 = (j + 0.2) / n;
                  const t1 = (j + 0.8) / n;
                  if (row[3] === 'side') {
                    const za = row[1] + (row[2] - row[1]) * t0;
                    const zb2 = row[1] + (row[2] - row[1]) * t1;
                    poly([[xn, y0 + 1.1, za], [xn, y0 + 1.1, zb2], [xn, ye - 1.2, zb2], [xn, ye - 1.2, za]], win);
                  } else {
                    const xa = row[0] + (row[1] - row[0]) * t0;
                    const xb = row[0] + (row[1] - row[0]) * t1;
                    poly([[xa, y0 + 1.1, zf], [xb, y0 + 1.1, zf], [xb, ye - 1.2, zf], [xa, ye - 1.2, zf]], win);
                  }
                }
              }
            }
            // Roof: the soffit under the overhang, then the slopes facing us.
            const o = b.overhangM;
            const en = spec.offsetM - side * (b.widthM / 2 + o);
            const ef = spec.offsetM + side * (b.widthM / 2 + o);
            const zfo = zf - o;
            const zbo = zb + o;
            const soffit = aerial(air, shadeFace(wall, [0, -1, 0], 0.2), xn, ye, zc);
            if (cam.eye < ye) poly([[en, ye, zfo], [ef, ye, zfo], [ef, ye, zbo], [en, ye, zbo]], soffit);
            if (b.roof === 'flat') {
              const r = aerial(air, shadeFace(roof, [0, 1, 0], 1), spec.offsetM, ye, zc);
              poly([[en, ye + 0.5, zfo], [ef, ye + 0.5, zfo], [ef, ye + 0.5, zbo], [en, ye + 0.5, zbo]], r);
              poly([[en, ye, zfo], [ef, ye, zfo], [ef, ye + 0.5, zfo], [en, ye + 0.5, zfo]], front);
            } else {
              const ridgeHalf = b.roof === 'hip' ? Math.max(0, b.depthM / 2 - b.widthM / 2) : b.depthM / 2 + o;
              const r0 = zc - ridgeHalf;
              const r1 = zc + ridgeHalf;
              const pitch = b.roofM / (b.widthM / 2 + o);
              const nFront: Vec3 = [0, 1, -pitch];
              const nNear: Vec3 = [-side * pitch, 1, 0];
              const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
              const unit = (v: Vec3): Vec3 => [v[0] / len(v), v[1] / len(v), v[2] / len(v)];
              const frontRoof = aerial(air, shadeFace(roof, unit(nFront), 0.9), spec.offsetM, yr, zf);
              const nearRoof = aerial(air, shadeFace(roof, unit(nNear), 0.9), xn, yr, zc);
              if (b.roof === 'hip') {
                poly([[en, ye, zfo], [ef, ye, zfo], [spec.offsetM, yr, r0]], frontRoof);
              } else {
                poly([[en, ye, zfo], [ef, ye, zfo], [spec.offsetM, yr, zfo]], front);
              }
              poly([[en, ye, zfo], [spec.offsetM, yr, r0], [spec.offsetM, yr, r1], [en, ye, zbo]], nearRoof);
              // A crisp eave line catches the light.
              const [e0x, e0y] = P(en, ye, zfo);
              const [e1x, e1y] = P(ef, ye, zfo);
              const [e2x, e2y] = P(en, ye, zbo);
              ctx.strokeStyle = css(scaleLin(frontRoof, 1.25), 0.7);
              ctx.lineWidth = 0.7;
              ctx.beginPath();
              ctx.moveTo(e1x, e1y);
              ctx.lineTo(e0x, e0y);
              ctx.lineTo(e2x, e2y);
              ctx.stroke();
            }
          },
        });
      }
    }

    items.sort((a, b) => b.key - a.key);
    ctx.globalAlpha = fr.alpha;
    ctx.lineCap = 'butt';
    for (const item of items) item.draw();
    ctx.globalAlpha = 1;
  }
}
