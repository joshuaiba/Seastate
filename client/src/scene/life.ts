import { aerial, css, transmittance, type Air } from './atmosphere';
import { NEAR, project, type Camera } from './camera';
import { addLin, hex, lit, scaleLin, toLin, type Lin } from './color';
import type { LifeSpec } from './spec';
import { hash11, type Sea } from './waves';

/*
 * Small things that give the scene its scale: surfers in the lineup, a line of pelicans, a few boats.
 * They're tiny on purpose and placed in the world, so perspective sizes them: a surfer 150 m out is a
 * few pixels. Surfers ride the actual swell from the wave model; nothing loops on a timer.
 */

export interface LifeFrame {
  cam: Camera;
  air: Air;
  sea: Sea;
  life: LifeSpec;
  tideM: number;
  sunLight: Lin;
  ambient: Lin;
  /** 0 at night, 1 by day. */
  daylight: number;
  night: number;
  surfFt: number;
  time: number;
  alpha: number;
}

const DARK = toLin(hex('#23262b'));
const HULL = toLin(hex('#e4e2dc'));

interface Flock {
  born: number;
  z: number;
  y: number;
  speed: number;
  dir: 1 | -1;
  birds: { lag: number; dy: number; dz: number; phase: number }[];
}

export class Life {
  private flock: Flock | null = null;
  private nextFlock = 5;

  step(time: number): void {
    if (this.flock && time - this.flock.born > 40) {
      this.flock = null;
      this.nextFlock = time + 20 + Math.random() * 35;
    }
    if (!this.flock && time > this.nextFlock) {
      const n = 3 + Math.floor(Math.random() * 5);
      this.flock = {
        born: time,
        z: 40 + Math.random() * 120,
        y: 4 + Math.random() * 7,
        speed: 8 + Math.random() * 3,
        dir: Math.random() < 0.5 ? 1 : -1,
        birds: Array.from({ length: n }, (_, i) => ({
          lag: i * (6 + Math.random() * 3),
          dy: (Math.random() - 0.5) * 1.2,
          dz: i * (Math.random() * 3 - 1),
          phase: Math.random() * 6,
        })),
      };
    }
  }

  draw(ctx: CanvasRenderingContext2D, fr: LifeFrame): void {
    ctx.globalAlpha = fr.alpha;
    this.drawShips(ctx, fr);
    this.drawSails(ctx, fr);
    this.drawSurfers(ctx, fr);
    ctx.globalAlpha = fr.alpha;
    this.drawBirds(ctx, fr);
    ctx.globalAlpha = 1;
  }

  private light(fr: LifeFrame, k = 1): Lin {
    return addLin(scaleLin(fr.ambient, 0.8), fr.sunLight, 0.6 * k);
  }

  private drawSurfers(ctx: CanvasRenderingContext2D, fr: LifeFrame): void {
    const { cam, sea, life } = fr;
    // Fewer out when it's flat, none after dark.
    const count = Math.round(life.surfers * Math.min(1, fr.surfFt / 2.5) * Math.min(1, fr.daylight * 1.6));
    const breakZ = sea.waterline + (sea.breakH * 1.15) / sea.gamma / sea.slope;
    const suit = aerial(fr.air, lit(DARK, this.light(fr, 0.3)), 0, 1, breakZ);
    for (let i = 0; i < count; i++) {
      const drift = Math.sin(fr.time * 0.013 + i * 2.1) * 6;
      const x = life.lineupM[0] + (life.lineupM[1] - life.lineupM[0]) * hash11(i * 4.7 + 0.3) + drift;
      const z = breakZ + 8 + hash11(i * 9.1) * 22;
      const y = fr.tideM + sea.elevation(x, z);
      const [sx, sy, depth] = project(cam, x, y, z);
      if (depth < NEAR || sx < -10 || sx > cam.W + 10) continue;
      const s = cam.f / depth;
      if (s * 1.6 < 1) continue;
      const T = transmittance(fr.air, depth, 1);
      const sitting = hash11(i * 3.3 + Math.floor(fr.time / 40)) > 0.35;
      // Board: mostly awash, the nose and tail showing.
      ctx.fillStyle = css(aerial(fr.air, lit(HULL, this.light(fr)), x, 0, z), 0.75 * T + 0.2);
      ctx.beginPath();
      ctx.ellipse(sx, sy, s * 1.05, Math.max(0.5, s * 0.1), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = css(suit);
      if (sitting) {
        // Upright from the waist, head and shoulders.
        ctx.beginPath();
        ctx.ellipse(sx, sy - s * 0.38, Math.max(0.6, s * 0.2), Math.max(0.8, s * 0.36), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(sx, sy - s * 0.86, Math.max(0.5, s * 0.12), 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Lying down to paddle: a low shape along the board.
        ctx.beginPath();
        ctx.ellipse(sx - s * 0.1, sy - s * 0.12, Math.max(0.8, s * 0.7), Math.max(0.5, s * 0.14), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(sx + s * 0.62, sy - s * 0.2, Math.max(0.5, s * 0.12), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawBirds(ctx: CanvasRenderingContext2D, fr: LifeFrame): void {
    const flock = this.flock;
    if (!flock || fr.daylight < 0.15) return;
    const { cam } = fr;
    const age = fr.time - flock.born;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const bird of flock.birds) {
      // Pelicans glide along the shore in a line, low over the water, a few wingbeats now and then.
      const x = cam.x - flock.dir * 260 + flock.dir * (age - bird.lag * 0.12) * flock.speed;
      const z = flock.z + bird.dz;
      const y = flock.y + bird.dy + Math.sin(fr.time * 0.6 + bird.phase) * 0.4;
      const [sx, sy, depth] = project(cam, x, y, z);
      if (depth < NEAR || sx < -30 || sx > cam.W + 30) continue;
      const s = (cam.f * 1.1) / depth;
      if (s < 1.2) continue;
      const cycle = (fr.time + bird.phase) % 6;
      const flap = cycle < 1.4 ? Math.sin(cycle * 7.5) * 0.5 : 0.06;
      ctx.strokeStyle = css(aerial(fr.air, lit(DARK, this.light(fr, 0.4)), x, y, z), 0.9 * Math.min(1, fr.daylight * 2));
      ctx.lineWidth = Math.max(1, s * 0.12);
      ctx.beginPath();
      ctx.moveTo(sx - s, sy - flap * s * 0.6 + s * 0.08);
      ctx.quadraticCurveTo(sx - s * 0.45, sy - s * 0.22 - flap * s * 0.3, sx, sy);
      ctx.quadraticCurveTo(sx + s * 0.45, sy - s * 0.22 - flap * s * 0.3, sx + s, sy - flap * s * 0.6 + s * 0.08);
      ctx.stroke();
    }
  }

  private drawSails(ctx: CanvasRenderingContext2D, fr: LifeFrame): void {
    const { cam, life } = fr;
    for (let i = 0; i < life.sailboats; i++) {
      // Out of the harbor on a reach, drifting slowly across the view.
      const b = 1600 + hash11(i * 5.1) * 3800;
      const a = ((hash11(i * 2.7) * 2 - 1) * 0.5 + ((fr.time * 2.5) / b) * (i % 2 ? 1 : -1)) * b;
      const x = cam.x + a * cam.cosYaw + b * cam.sinYaw;
      const z = cam.z - a * cam.sinYaw + b * cam.cosYaw;
      const [sx, sy, depth] = project(cam, x, fr.tideM, z);
      if (sx < -20 || sx > cam.W + 20) continue;
      const s = cam.f / depth;
      const T = transmittance(fr.air, depth, 5);
      const sail = aerial(fr.air, lit(HULL, this.light(fr)), x, 6, z);
      const heel = 0.18 * (i % 2 ? 1 : -1);
      ctx.fillStyle = css(sail, Math.min(1, 0.4 + T));
      ctx.beginPath();
      ctx.moveTo(sx - s * 2, sy - s * 0.8);
      ctx.lineTo(sx + s * 2.6 * heel * 4, sy - Math.max(3, s * 11));
      ctx.lineTo(sx + s * 2.4, sy - s * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = css(aerial(fr.air, lit(DARK, this.light(fr)), x, 1, z));
      ctx.fillRect(sx - s * 4, sy - s * 0.8, s * 8, Math.max(0.8, s * 0.8));
    }
  }

  private drawShips(ctx: CanvasRenderingContext2D, fr: LifeFrame): void {
    const { cam, life } = fr;
    for (let i = 0; i < life.ships; i++) {
      // A container ship on the approach to Long Beach, far out and slow.
      const b = 16000 + hash11(i * 3.9 + 1) * 6000;
      const a = (hash11(i * 8.3) - 0.5) * b * 0.6 + fr.time * 4 * (i % 2 ? -1 : 1);
      const x = cam.x + a * cam.cosYaw + b * cam.sinYaw;
      const z = cam.z - a * cam.sinYaw + b * cam.cosYaw;
      const drop = (b * b) / (2 * 7.3e6);
      const [sx, sy, depth] = project(cam, x, -drop, z);
      if (sx < -40 || sx > cam.W + 40) continue;
      const s = cam.f / depth;
      const color = aerial(fr.air, lit(DARK, this.light(fr, 0.5)), x, 10, z);
      ctx.fillStyle = css(color);
      const len = 290 * s;
      ctx.fillRect(sx - len / 2, sy - 14 * s, len, 14 * s);
      ctx.fillRect(sx - len / 2 + len * 0.1, sy - 26 * s, len * 0.66, 12 * s);
      ctx.fillRect(sx + len * 0.3, sy - 40 * s, len * 0.08, 26 * s);
      if (fr.night > 0.1) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(255,220,170,${(fr.night * transmittance(fr.air, depth, 20) * 0.9).toFixed(3)})`;
        ctx.fillRect(sx + len * 0.33 - 0.6, sy - 40 * s - 0.6, 1.2, 1.2);
        ctx.fillRect(sx - len * 0.45 - 0.6, sy - 20 * s - 0.6, 1.2, 1.2);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  }
}
