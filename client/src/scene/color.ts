/** An sRGB color as 0–255 channels. */
export type Rgb = readonly [number, number, number];

export function hex(value: string): Rgb {
  const n = parseInt(value.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.min(1, Math.max(0, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

export function scale(a: Rgb, k: number): Rgb {
  return [a[0] * k, a[1] * k, a[2] * k];
}

export function rgba(c: Rgb, alpha = 1): string {
  return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${alpha.toFixed(3)})`;
}

export function luminance(c: Rgb): number {
  return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
}

/** A linear-light color, roughly 0–1 per channel (light can exceed 1). */
export type Lin = [number, number, number];

export function toLin(c: Rgb): Lin {
  return [(c[0] / 255) ** 2.2, (c[1] / 255) ** 2.2, (c[2] / 255) ** 2.2];
}

export function fromLin(c: readonly number[]): Rgb {
  const e = (v: number) => 255 * Math.min(1, Math.max(0, v ?? 0)) ** (1 / 2.2);
  return [e(c[0]!), e(c[1]!), e(c[2]!)];
}

/** Albedo lit by some light, both linear. */
export function lit(albedo: readonly number[], light: readonly number[]): Lin {
  return [albedo[0]! * light[0]!, albedo[1]! * light[1]!, albedo[2]! * light[2]!];
}

export function addLin(a: readonly number[], b: readonly number[], k = 1): Lin {
  return [a[0]! + b[0]! * k, a[1]! + b[1]! * k, a[2]! + b[2]! * k];
}

export function mixLin(a: readonly number[], b: readonly number[], t: number): Lin {
  return [a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t, a[2]! + (b[2]! - a[2]!) * t];
}

export function scaleLin(a: readonly number[], k: number): Lin {
  return [a[0]! * k, a[1]! * k, a[2]! * k];
}
