import { useId, type CSSProperties } from 'react';
import type { BeachInfo } from '@seastate/shared';
import { themeFor } from '../theme/beaches';
import styles from './StripMap.module.css';

/*
 * The coast from Long Beach to Crystal Cove as a strip chart: projected from real coordinates, then
 * turned so the shoreline runs across the page (land above, sea below), the way a chart of a long coast
 * is cut into strips. The north arrow shows how far it's turned. Soundings below the shore drift slowly.
 */

/** Approximate shoreline, northwest to southeast, [lat, lon]. */
const SHORE: [number, number][] = [
  [33.7465, -118.13],
  [33.742, -118.118],
  [33.737, -118.106],
  [33.728, -118.093],
  [33.716, -118.068],
  [33.702, -118.054],
  [33.688, -118.041],
  [33.672, -118.021],
  [33.655, -118.0035],
  [33.638, -117.978],
  [33.629, -117.958],
  [33.607, -117.9295],
  [33.599, -117.9],
  [33.593, -117.882],
  [33.59, -117.866],
  [33.582, -117.852],
  [33.571, -117.835],
];

const W = 1000;
const H = 200;
const SHORE_Y = 92;
const LAT0 = 33.66;
const K = Math.cos((LAT0 * Math.PI) / 180);

type Pt = [number, number];

/** Degrees → a flat local frame (x east, y south), in degrees of latitude. */
const flat = ([lat, lon]: [number, number]): Pt => [lon * K, -lat];

// Turn so the shore's overall run (first point to last) is horizontal.
const first = flat(SHORE[0]!);
const last = flat(SHORE[SHORE.length - 1]!);
const THETA = Math.atan2(last[1] - first[1], last[0] - first[0]);
const turn = ([x, y]: Pt): Pt => [
  x * Math.cos(THETA) + y * Math.sin(THETA),
  -x * Math.sin(THETA) + y * Math.cos(THETA),
];

const shoreTurned = SHORE.map((p) => turn(flat(p)));
const minX = Math.min(...shoreTurned.map((p) => p[0]));
const maxX = Math.max(...shoreTurned.map((p) => p[0]));
const meanY = shoreTurned.reduce((s, p) => s + p[1], 0) / shoreTurned.length;
const SCALE = (W - 40) / (maxX - minX);

const place = (latLon: [number, number]): Pt => {
  const [x, y] = turn(flat(latLon));
  return [20 + (x - minX) * SCALE, SHORE_Y + (y - meanY) * SCALE];
};

/** A smooth line through the points (Catmull-Rom as cubic Béziers). */
function smooth(points: Pt[]): string {
  let d = `M${points[0]![0].toFixed(1)} ${points[0]![1].toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

const SHORE_POINTS = SHORE.map(place);
const SHORE_PATH = smooth(SHORE_POINTS);
const LAND_PATH = `${SHORE_PATH}L${W} ${SHORE_POINTS.at(-1)![1].toFixed(1)}L${W} 0L0 0L0 ${SHORE_POINTS[0]![1].toFixed(1)}Z`;
/** Where true north points on the turned chart. */
const NORTH_DEG = (-THETA * 180) / Math.PI;

export function StripMap({ beaches }: { beaches: BeachInfo[] }) {
  const id = useId();
  const fade = `${id}-fade`;
  const land = `${id}-land`;
  return (
    <svg
      className={styles.map}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Map of the coast from Seal Beach to Newport Beach"
    >
      <defs>
        {/* The coast runs off both ends of the strip rather than stopping at an edge. */}
        <linearGradient id={`${fade}-g`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.1" stopColor="#fff" />
          <stop offset="0.9" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id={fade} maskUnits="userSpaceOnUse" x="0" y="-60" width={W} height={H + 120}>
          <rect x="0" y="-60" width={W} height={H + 120} fill={`url(#${fade}-g)`} />
        </mask>
        <linearGradient id={land} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="rgb(160, 196, 216)" stopOpacity="0" />
          <stop offset="1" stopColor="rgb(160, 196, 216)" stopOpacity="0.07" />
        </linearGradient>
      </defs>
      <g mask={`url(#${fade})`}>
        <path d={LAND_PATH} fill={`url(#${land})`} />
        {/* Soundings: the shoreline repeated offshore, fainter with depth. */}
        {[16, 36, 62, 94].map((dy, i) => (
          <path
            key={dy}
            d={SHORE_PATH}
            transform={`translate(0 ${dy})`}
            className={styles.sounding}
            style={{ opacity: 0.55 - i * 0.12, animationDuration: `${60 + i * 25}s` }}
          />
        ))}
        <path d={SHORE_PATH} className={styles.shore} />
      </g>
      <text x={W - 24} y={H - 18} className={styles.sea} textAnchor="end">
        Pacific Ocean
      </text>

      {beaches.map((beach) => {
        const [x, y] = place([beach.lat, beach.lon]);
        return (
          <g key={beach.id} style={{ '--dot': themeFor(beach.id).accent } as CSSProperties}>
            <line x1={x} y1={y - 8} x2={x} y2={y - 34} className={styles.leader} />
            <circle cx={x} cy={y} r={4} className={styles.dot} />
            <circle cx={x} cy={y} r={4} className={styles.ring} />
            <text x={x} y={y - 42} textAnchor="middle" className={styles.label}>
              {beach.name}
            </text>
          </g>
        );
      })}

      <g transform={`translate(${W - 40} 32) rotate(${NORTH_DEG})`} className={styles.north}>
        <line x1={0} y1={12} x2={0} y2={-12} />
        <path d="M-4 -6 0 -13 4 -6" />
        <text x={0} y={27} textAnchor="middle" transform={`rotate(${-NORTH_DEG} 0 22)`}>
          N
        </text>
      </g>
    </svg>
  );
}
