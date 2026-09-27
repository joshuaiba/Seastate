import { aerial, css, transmittance, type Air } from './atmosphere';
import { curvatureDrop, EARTH_R, project, type Camera } from './camera';
import { addLin, hex, lit, scaleLin, toLin, type Lin } from './color';
import { bearingTo, LANDMARKS, type GeoPoint, type Landmark } from './landmarks';
import { hash11 } from './waves';

/*
 * The far horizon: islands, headlands, platforms and the breakwater, each placed from real coordinates
 * relative to wherever the camera stands, at true angular size (lifted a little so a 640 m island 45 km
 * off still reads), with the earth's curvature hiding the base and haze taking most of the contrast.
 * If a beach's view is open ocean, nothing is drawn: the negative space is the point.
 */

/** Vertical exaggeration for distant land. Kept small; true scale is 1. */
const LIFT = 1.3;

export interface HorizonFrame {
  cam: Camera;
  air: Air;
  lat: number;
  lon: number;
  sunLight: Lin;
  ambient: Lin;
  moonLight: Lin;
  /** 0–1, lights on. */
  night: number;
  time: number;
  surfM: number;
  periodS: number;
  alpha: number;
}

const LAND = toLin(hex('#6f6e5c'));
const STEEL = toLin(hex('#5b5e60'));
const ROCK = toLin(hex('#4a4640'));

/** Ridge crests with fractal detail between the surveyed points, computed once per landmark. */
const detailCache = new Map<string, GeoPoint[]>();

function detailed(mark: Landmark): GeoPoint[] {
  const cached = detailCache.get(mark.id);
  if (cached) return cached;
  let pts = mark.points.slice();
  const rough = mark.roughness ?? 0.4;
  let amp = 0.07 * rough;
  let seed = mark.id.length * 13.7;
  for (let level = 0; level < 4; level++) {
    const next: GeoPoint[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      next.push(a);
      const lenKm = Math.hypot((b.lat - a.lat) * 111, (b.lon - a.lon) * 93);
      const r = hash11(seed++) - 0.5;
      const mid = (a.heightKm + b.heightKm) / 2;
      // Keep the coastline ends at sea level; let the interior wander.
      const h = a.heightKm === 0 && b.heightKm === 0 ? 0 : Math.max(0.005, mid + r * amp * Math.min(1, lenKm));
      next.push({ lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2, heightKm: h });
    }
    next.push(pts[pts.length - 1]!);
    pts = next;
    amp *= 0.55;
  }
  detailCache.set(mark.id, pts);
  return pts;
}

export function drawHorizon(ctx: CanvasRenderingContext2D, fr: HorizonFrame): void {
  ctx.globalAlpha = fr.alpha;
  const marks = LANDMARKS.map((mark) => {
    const first = mark.points[0]!;
    return { mark, distanceKm: bearingTo(fr.lat, fr.lon, first.lat, first.lon).distanceKm };
  }).sort((a, b) => b.distanceKm - a.distanceKm);
  // Beyond the sea horizon, anything lower than it is hidden behind the curve of the sea; the
  // breakwater and near platforms stand in front of it and aren't.
  const horizonM = Math.sqrt(2 * Math.max(1, fr.cam.eye) * EARTH_R);
  for (const { mark, distanceKm } of marks) {
    const beyond = distanceKm * 1000 > horizonM;
    if (beyond) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, fr.cam.W, fr.cam.seaHorizonY);
      ctx.clip();
    }
    if (mark.kind === 'ridge') drawRidge(ctx, fr, mark);
    else if (mark.kind === 'platform') drawPlatform(ctx, fr, mark);
    else drawBreakwater(ctx, fr, mark);
    if (beyond) ctx.restore();
  }
}

/** World position of a geographic point as seen from the camera's own coordinates. */
function toWorld(fr: HorizonFrame, p: GeoPoint): { x: number; y: number; z: number; d: number } {
  const { bearingDeg, distanceKm } = bearingTo(fr.lat, fr.lon, p.lat, p.lon);
  const rel = ((bearingDeg - fr.cam.facingDeg) * Math.PI) / 180;
  const d = distanceKm * 1000;
  return { x: fr.cam.x + Math.sin(rel) * d, y: p.heightKm * 1000 * LIFT - curvatureDrop(d), z: fr.cam.z + Math.cos(rel) * d, d };
}

function inView(cam: Camera, x: number, z: number): boolean {
  const depth = (x - cam.x) * cam.sinYaw + (z - cam.z) * cam.cosYaw;
  const across = (x - cam.x) * cam.cosYaw - (z - cam.z) * cam.sinYaw;
  return depth > 0 && Math.abs((cam.f * across) / depth) < cam.W * 0.75;
}

function drawRidge(ctx: CanvasRenderingContext2D, fr: HorizonFrame, mark: Landmark): void {
  const { cam, air } = fr;
  const pts = detailed(mark).map((p) => toWorld(fr, p));
  if (!pts.some((p) => inView(cam, p.x, p.z))) return;
  const mid = pts[Math.floor(pts.length / 2)]!;
  if (mid.d > 95_000) return;

  // The face we see looks back toward us; it's lit only when the sun is behind the viewer.
  const toward = [cam.x - mid.x, 0, cam.z - mid.z];
  const len = Math.hypot(toward[0]!, toward[2]!) || 1;
  const sunOnFace = Math.max(0, (toward[0]! * air.sunDir[0] + toward[2]! * air.sunDir[2]) / len) * 0.55 + Math.max(0, air.sunDir[1]) * 0.45;
  const light = addLin(addLin(scaleLin(fr.ambient, 0.75), fr.sunLight, sunOnFace), fr.moonLight, 0.5);
  const albedo = lit(LAND, light);
  const peak = pts.reduce((m, p) => Math.max(m, p.y), 0);
  const top = aerial(air, albedo, mid.x, peak * 0.8, mid.z);
  const base = aerial(air, albedo, mid.x, 0, mid.z);

  const screen = pts.map((p) => project(cam, p.x, p.y, p.z));
  let minY = Infinity;
  for (const s of screen) minY = Math.min(minY, s[1]);
  const g = ctx.createLinearGradient(0, minY, 0, cam.seaHorizonY);
  g.addColorStop(0, css(top));
  g.addColorStop(1, css(base));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(screen[0]![0], cam.seaHorizonY + 2);
  for (const s of screen) ctx.lineTo(s[0], Math.min(s[1], cam.seaHorizonY + 2));
  ctx.lineTo(screen[screen.length - 1]![0], cam.seaHorizonY + 2);
  ctx.closePath();
  ctx.fill();
}

function drawPlatform(ctx: CanvasRenderingContext2D, fr: HorizonFrame, mark: Landmark): void {
  const { cam, air } = fr;
  const w = toWorld(fr, mark.points[0]!);
  if (!inView(cam, w.x, w.z) || w.d > 40_000 || w.d < 600) return;
  const drop = curvatureDrop(w.d);
  const P = (x: number, y: number) => project(cam, w.x + x, y - drop, w.z);
  const [cx, cy, depth] = P(0, 0);
  const s = cam.f / depth; // px per metre
  const T = transmittance(air, w.d, 20);
  const color = aerial(air, lit(STEEL, addLin(scaleLin(fr.ambient, 0.7), fr.sunLight, 0.35)), w.x, 20, w.z);
  ctx.fillStyle = css(color);
  ctx.strokeStyle = css(color);
  ctx.lineWidth = Math.max(0.6, s * 1.6);
  // Jacket legs, the deck with its modules, the drilling derrick and a crane.
  const deckY = cy - s * 24;
  ctx.beginPath();
  ctx.moveTo(cx - s * 20, cy);
  ctx.lineTo(cx - s * 18, deckY);
  ctx.moveTo(cx + s * 20, cy);
  ctx.lineTo(cx + s * 18, deckY);
  ctx.stroke();
  ctx.fillRect(cx - s * 30, deckY - s * 5, s * 60, s * 5);
  ctx.fillRect(cx - s * 26, deckY - s * 16, s * 30, s * 11);
  ctx.fillRect(cx + s * 6, deckY - s * 11, s * 18, s * 6);
  ctx.beginPath();
  ctx.moveTo(cx + s * 10, deckY - s * 11);
  ctx.lineTo(cx + s * 15, deckY - s * 52);
  ctx.lineTo(cx + s * 20, deckY - s * 11);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = Math.max(0.5, s * 1);
  ctx.beginPath();
  ctx.moveTo(cx - s * 24, deckY - s * 16);
  ctx.lineTo(cx - s * 44, deckY - s * 30);
  ctx.stroke();
  if (fr.night > 0.05) {
    // Platforms work all night: a scatter of deck lights and a red light on the derrick.
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      const lx = cx + s * (hash11(i * 3.7 + w.d) * 56 - 28);
      const ly = deckY - s * (hash11(i * 5.3 + 1) * 14);
      ctx.fillStyle = `rgba(255,214,160,${(fr.night * T * 0.85).toFixed(3)})`;
      ctx.fillRect(lx - 0.6, ly - 0.6, 1.2, 1.2);
    }
    const pulse = 0.55 + 0.45 * Math.sin(fr.time * 1.1 + mark.id.length);
    ctx.fillStyle = `rgba(255,90,70,${(fr.night * T * pulse).toFixed(3)})`;
    ctx.fillRect(cx + s * 15 - 0.8, deckY - s * 52 - 0.8, 1.6, 1.6);
    ctx.globalCompositeOperation = 'source-over';
  }
}

function drawBreakwater(ctx: CanvasRenderingContext2D, fr: HorizonFrame, mark: Landmark): void {
  const { cam, air } = fr;
  // Walk the breakwater in short steps: its near end can be a couple of kilometres off and its far
  // end ten, so the crest line tapers into the distance.
  const pts: { x: number; z: number; d: number }[] = [];
  for (let i = 0; i < mark.points.length - 1; i++) {
    const a = mark.points[i]!;
    const b = mark.points[i + 1]!;
    for (let j = 0; j < 12; j++) {
      const t = j / 12;
      const w = toWorld(fr, { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t, heightKm: 0 });
      pts.push({ x: w.x, z: w.z, d: w.d });
    }
  }
  if (!pts.some((p) => inView(cam, p.x, p.z))) return;
  const crest = 3.8;
  const mid = pts[Math.floor(pts.length / 3)]!;
  const light = addLin(scaleLin(fr.ambient, 0.7), fr.sunLight, 0.3);
  const color = aerial(air, lit(ROCK, light), mid.x, 2, mid.z);
  const tops = pts.map((p) => project(cam, p.x, crest * LIFT * 1.6 - curvatureDrop(p.d), p.z));
  const feet = pts.map((p) => project(cam, p.x, -curvatureDrop(p.d), p.z));
  ctx.fillStyle = css(color);
  ctx.beginPath();
  tops.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  for (let i = feet.length - 1; i >= 0; i--) ctx.lineTo(feet[i]![0], feet[i]![1] + 0.6);
  ctx.closePath();
  ctx.fill();

  // Swell bursting white on the rocks as each set line reaches them.
  if (fr.surfM > 0.25 && fr.ambient[1] > 0.02) {
    const omega = (Math.PI * 2) / Math.max(6, fr.periodS);
    for (let i = 0; i < tops.length; i += 2) {
      const p = pts[i]!;
      const phase = fr.time * omega - p.x * 0.004 + hash11(i) * 0.6;
      const burst = Math.pow(Math.max(0, Math.sin(phase)), 10) * Math.min(1, fr.surfM);
      if (burst < 0.05) continue;
      const [x, y, depth] = tops[i]!;
      const s = cam.f / depth;
      const h = Math.max(0.8, s * 6 * burst);
      ctx.fillStyle = css(aerial(air, lit([0.85, 0.88, 0.9], addLin(fr.ambient, fr.sunLight, 0.9)), p.x, 4, p.z), 0.8 * burst);
      ctx.beginPath();
      ctx.ellipse(x, y - h * 0.4, Math.max(1, s * 9), h, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
