/*
 * The one camera both layers of the scene render through: the WebGL sea and sky, and the 2D canvas for
 * the pier, land and life. A level pinhole with a shifted lens (like an architectural camera), so the
 * horizon can sit anywhere in the frame while piles and walls stay vertical.
 *
 * World frame is scene/spec.ts's: X alongshore (right), Y up from mean sea level, Z seaward.
 */

const RAD = Math.PI / 180;

/** Earth radius with standard atmospheric refraction (k = 0.13), m. Sets the sea horizon's distance. */
export const EARTH_R = 7.3e6;

export interface Camera {
  /** Viewport, CSS px. */
  W: number;
  H: number;
  /** Focal length, px. */
  f: number;
  /** Where a level line of sight lands on screen, px from the top. */
  horizonY: number;
  /** Where the sea actually ends, a few px lower: the horizon dips with height. */
  seaHorizonY: number;
  /** Camera position. */
  x: number;
  eye: number;
  z: number;
  sinYaw: number;
  cosYaw: number;
  /** The shore normal's bearing (the beach's facingDeg). */
  facingDeg: number;
}

export interface CameraSetup {
  W: number;
  H: number;
  facingDeg: number;
  yawDeg: number;
  setbackM: number;
  seaBand: number;
  /** Small offsets for parallax and transitions, m. */
  dx?: number;
  dEye?: number;
}

function isPortrait(W: number, H: number): boolean {
  return W / H < 0.9;
}

/**
 * Frames the view for a viewport. The field of view is about 60° across on ordinary screens and opens
 * up on ultrawides. The eye height is whatever puts the mean waterline `seaBand` of the frame below the
 * horizon, so the composition holds from a phone to a cinema display.
 */
export function makeCamera(s: CameraSetup): Camera {
  const portrait = isPortrait(s.W, s.H);
  const f = Math.min(0.87 * s.W, 1.55 * s.H);
  const horizonY = s.H * (portrait ? 0.4 : 0.46);
  const yaw = s.yawDeg * RAD;
  const band = s.H * s.seaBand * (portrait ? 0.82 : 1);
  const eye = Math.min(40, Math.max(5, (band * s.setbackM) / (f * Math.cos(yaw)))) + (s.dEye ?? 0);
  const dip = Math.sqrt((2 * eye) / EARTH_R);
  return {
    W: s.W,
    H: s.H,
    f,
    horizonY,
    seaHorizonY: horizonY + f * Math.tan(dip),
    x: s.dx ?? 0,
    eye,
    z: -s.setbackM,
    sinYaw: Math.sin(yaw),
    cosYaw: Math.cos(yaw),
    facingDeg: s.facingDeg,
  };
}

/** Near clip plane, m. Anything closer isn't drawn. */
export const NEAR = 1.5;

/**
 * World point to screen. Returns [x, y, depth]; depth below NEAR means behind or too close, and x, y
 * are then meaningless.
 */
export function project(c: Camera, X: number, Y: number, Z: number): [number, number, number] {
  const dx = X - c.x;
  const dz = Z - c.z;
  const depth = dx * c.sinYaw + dz * c.cosYaw;
  const across = dx * c.cosYaw - dz * c.sinYaw;
  const inv = c.f / Math.max(depth, 1e-3);
  return [c.W / 2 + across * inv, c.horizonY - (Y - c.eye) * inv, depth];
}

/** Unit world direction of a compass bearing and elevation. */
export function directionOf(facingDeg: number, bearingDeg: number, elevationDeg: number): [number, number, number] {
  const rel = (bearingDeg - facingDeg) * RAD;
  const el = elevationDeg * RAD;
  return [Math.sin(rel) * Math.cos(el), Math.sin(el), Math.cos(rel) * Math.cos(el)];
}

/** How far below a straight line of sight the earth has curved away at distance d, m. */
export function curvatureDrop(distanceM: number): number {
  return (distanceM * distanceM) / (2 * EARTH_R);
}
