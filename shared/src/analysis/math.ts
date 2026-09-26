export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** Piecewise-linear lookup through `points` (sorted by x). Flat beyond either end. */
export function piecewise(x: number, points: readonly (readonly [number, number])[]): number {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return 0;
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    if (x <= x1) {
      const [x0, y0] = points[i - 1]!;
      return lerp(y0, y1, (x - x0) / (x1 - x0));
    }
  }
  return last[1];
}

/** The smaller angle between two bearings, 0–180°. */
export function angleDiff(a: number, b: number): number {
  const d = mod(a - b, 360);
  return d > 180 ? 360 - d : d;
}

/** Interpolates between two bearings the short way round. */
export function lerpAngle(a: number, b: number, t: number): number {
  const d = mod(b - a + 180, 360) - 180;
  return mod(a + d * t, 360);
}

export function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** The value at fraction `q` (0–1) of the sorted values, interpolated. */
export function quantile(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lerp(sorted[lo]!, sorted[hi]!, pos - lo);
}
