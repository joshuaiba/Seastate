import { hex, mix, scale, type Rgb } from './color';

/*
 * Scene lighting. Sky colors are keyframed by sun elevation, with separate dawn and dusk sets (dawn is
 * cooler and pinker, dusk warmer and more amber), then shifted by cloud cover, fog, rain, and each
 * beach's warmth. Everything else (water, sand, silhouettes) derives from the sky so the scene is lit
 * consistently.
 */

export interface Palette {
  zenith: Rgb;
  mid: Rgb;
  horizon: Rgb;
  sunGlow: Rgb;
  cloudLit: Rgb;
  cloudShade: Rgb;
  waterFar: Rgb;
  waterNear: Rgb;
  waterShallow: Rgb;
  foam: Rgb;
  sand: Rgb;
  sandNear: Rgb;
  wetSand: Rgb;
  /** Near structures (the pier). */
  silhouette: Rgb;
  /** Distant land before haze. */
  farLand: Rgb;
  /** 0 at night, 1 in full daylight. */
  light: number;
  /** How visible stars are, 0–1. */
  night: number;
  /** Strength of the sun's glitter path on the water, 0–1. */
  glitter: number;
}

export interface Lighting {
  sunElevationDeg: number;
  /** True before solar noon. */
  morning: boolean;
  cloudCover: number;
  fog: number;
  rain: number;
  warmth: number;
  /** 0–1: how directly the sun sits in view (for glitter). */
  sunInView: number;
}

type SkyKey = [elevation: number, zenith: string, mid: string, horizon: string];

const DAWN: SkyKey[] = [
  [-18, '#030914', '#081226', '#121e36'],
  [-10, '#081330', '#1a2550', '#3c3f68'],
  [-4, '#1a2d5c', '#5a5f8c', '#c9a0a8'],
  [0, '#28457a', '#8a93b8', '#f2c2a8'],
  [6, '#3a68a6', '#9dbad8', '#f0dcc8'],
  [15, '#3d77ba', '#8cb9dc', '#dbe8ee'],
  [35, '#3574bd', '#80b3dc', '#d3e6f0'],
];

const DUSK: SkyKey[] = [
  [-18, '#030914', '#081226', '#121e36'],
  [-10, '#0a1230', '#241f4c', '#4a3860'],
  [-4, '#1c2858', '#6a4f78', '#e0907a'],
  [0, '#2a3d74', '#a8708a', '#ffa868'],
  [6, '#3a62a0', '#b8a0a8', '#ffcf98'],
  [15, '#3d77ba', '#8cb9dc', '#dbe8ee'],
  [35, '#3574bd', '#80b3dc', '#d3e6f0'],
];

function sky(keys: SkyKey[], elevation: number): [Rgb, Rgb, Rgb] {
  const first = keys[0]!;
  const last = keys[keys.length - 1]!;
  if (elevation <= first[0]) return [hex(first[1]), hex(first[2]), hex(first[3])];
  if (elevation >= last[0]) return [hex(last[1]), hex(last[2]), hex(last[3])];
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i]!;
    if (elevation <= b[0]) {
      const a = keys[i - 1]!;
      const t = (elevation - a[0]) / (b[0] - a[0]);
      return [mix(hex(a[1]), hex(b[1]), t), mix(hex(a[2]), hex(b[2]), t), mix(hex(a[3]), hex(b[3]), t)];
    }
  }
  return [hex(last[1]), hex(last[2]), hex(last[3])];
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const WARM = hex('#ffb070');
const COOL = hex('#9cc8ff');

export function paletteFor(l: Lighting): Palette {
  const e = l.sunElevationDeg;
  const light = smooth(-10, 14, e);
  const night = 1 - smooth(-14, -5, e);
  const golden = smooth(-6, 0, e) * (1 - smooth(4, 14, e));

  let [zenith, mid, horizon] = sky(l.morning ? DAWN : DUSK, e);

  // Cloud: the sky flattens toward gray. A thin layer barely shows; overcast takes over.
  const cover = Math.pow(Math.min(1, Math.max(0, l.cloudCover)), 1.6) * 0.82;
  const grayTop = mix(hex('#0c121c'), hex('#7f8c99'), light);
  const grayLow = mix(hex('#141a24'), hex('#aeb9c3'), light);
  zenith = mix(zenith, grayTop, cover);
  mid = mix(mid, mix(grayTop, grayLow, 0.5), cover);
  horizon = mix(horizon, grayLow, cover * 0.85);

  // Marine layer / fog: a milky horizon.
  const fogColor = mix(hex('#1a2230'), hex('#c2ccd3'), light);
  horizon = mix(horizon, fogColor, l.fog * 0.75);
  mid = mix(mid, fogColor, l.fog * 0.45);

  if (l.rain > 0) {
    const dim = 1 - 0.18 * l.rain;
    zenith = scale(zenith, dim);
    mid = scale(mid, dim);
    horizon = scale(horizon, dim);
  }

  const tint = (c: Rgb, amount: number) =>
    l.warmth >= 0 ? mix(c, WARM, l.warmth * amount) : mix(c, COOL, -l.warmth * amount);
  horizon = tint(horizon, 0.16);

  const sunGlow = tint(
    e < 0 ? hex(l.morning ? '#ffb08a' : '#ff9a60') : mix(hex('#ffcf90'), hex('#fff3dc'), smooth(4, 20, e)),
    0.12,
  );

  const deepDay = hex('#15485e');
  const deepNight = hex('#040c16');
  const waterNear = mix(mix(deepNight, deepDay, light), hex('#1d3345'), golden * 0.4);
  const waterFar = mix(mix(horizon, waterNear, 0.42), hex('#27485c'), 0.2 * light);
  const waterShallow = mix(waterNear, mix(hex('#0a1c24'), hex('#2f8187'), light), 0.55);

  const sandDay = tint(hex('#dcc6a2'), 0.2);
  const sandGolden = hex(l.morning ? '#cfae9a' : '#e0ab80');
  const sand = mix(mix(hex('#1c1f28'), sandDay, light), sandGolden, golden * 0.65);
  const sandNear = scale(sand, 0.86);
  const wetSand = mix(scale(sand, 0.62), mix(horizon, waterNear, 0.5), 0.28);

  const foam = mix(hex('#5f7489'), hex('#f4fbff'), smooth(-8, 8, e));

  // Structures read darker when backlit (low sun ahead) and at night.
  const silhouette = mix(mix(hex('#070b12'), hex('#34434f'), light), hex('#16141c'), golden * 0.7);
  const farLand = mix(mix(hex('#0c1422'), hex('#687f90'), light), hex('#6c5a74'), golden * 0.5);

  return {
    zenith,
    mid,
    horizon,
    sunGlow,
    cloudLit: mix(mix(hex('#1d2533'), hex('#ffffff'), light), sunGlow, golden * 0.55),
    cloudShade: mix(mix(hex('#0d121b'), hex('#b6c3d0'), light), hex('#6a5670'), golden * 0.45),
    waterFar,
    waterNear,
    waterShallow,
    foam,
    sand,
    sandNear,
    wetSand,
    silhouette,
    farLand,
    light,
    night,
    glitter: Math.max(0, smooth(-3, 6, e) * (1 - Math.pow(Math.min(1, l.cloudCover), 1.3) * 0.85) * l.sunInView),
  };
}
