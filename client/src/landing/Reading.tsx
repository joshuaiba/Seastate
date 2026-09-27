import { useEffect, useMemo, useRef } from 'react';
import { clamp, describeWeather, metersToFeet, mpsToMph, type BeachAnalysis } from '@seastate/shared';
import { fmtF } from '../lib/format';
import { useReducedMotion, useSeen } from '../lib/hooks';
import { Kicker } from './ui';
import styles from './Reading.module.css';

/*
 * The idea in one picture: five signals, each moving the way its data does, calm down and merge into a
 * single line that ends at the verdict. The traces are drawn from the featured beach's real conditions
 * (bigger surf draws taller swell, stronger wind draws more chatter), so the diagram is live too.
 */

interface Lane {
  name: string;
  value: string;
  /** Offset from the lane's center line at x (0–SIGNAL_END) and time t (s), in viewBox units. */
  wave: (x: number, t: number) => number;
}

const W = 1000;
const LANE_H = 56;
const LANES = 5;
const H = LANE_H * LANES;
/** Where the signals have calmed and the curves toward the merge begin. */
const SIGNAL_END = 560;
const MERGE_AT = 860;
const STEP = 5;

const TAU = Math.PI * 2;

function lanesFor(analysis: BeachAnalysis | null): Lane[] {
  const sample = analysis?.now.sample;
  const surf = analysis?.now.scores.surf;
  const faceFt = surf?.surf.faceFt ?? 2.5;
  const periodS = surf?.surf.dominant?.periodS ?? 11;
  const mph = sample?.windSpeedMps == null ? 6 : mpsToMph(sample.windSpeedMps);
  const cloud = (sample?.cloudCoverPct ?? 30) / 100;
  const rising = (sample?.tideRateMPerHour ?? 0) >= 0;

  const surfAmp = 6 + clamp(faceFt / 6, 0, 1) * 13;
  const swellLength = 40 + periodS * 5;
  const windAmp = 2.5 + clamp(mph / 20, 0, 1) * 8;
  const tideDir = rising ? 1 : -1;

  const weather = sample ? describeWeather(sample.weatherCode, sample.cloudCoverPct) : null;
  const pending = '—';

  return [
    {
      name: 'Surf',
      value: surf ? `${surf.surf.label}${surf.surf.dominant ? ` at ${Math.round(periodS)}s` : ''}` : pending,
      // Swell arriving in sets: a long carrier wave, swelling and fading in groups.
      wave: (x, t) =>
        surfAmp *
        Math.sin(TAU * (x / swellLength - t / 3.2)) *
        (0.6 + 0.4 * Math.sin(TAU * (x / (swellLength * 5.5) - t / 14))),
    },
    {
      name: 'Wind',
      value: surf?.wind ? `${Math.round(mph)} mph, ${surf.wind.label.toLowerCase()}` : pending,
      // Chatter: short, quick, uneven.
      wave: (x, t) =>
        windAmp *
        (0.5 * Math.sin(x / 7 - t * 3.4) + 0.3 * Math.sin(x / 3.7 + t * 5.1) + 0.2 * Math.sin(x / 2.1 - t * 7.3)),
    },
    {
      name: 'Tide',
      value:
        sample?.tideM != null
          ? `${metersToFeet(sample.tideM).toFixed(1)} ft, ${rising ? 'rising' : 'falling'}`
          : pending,
      // One long, slow breath, leaning the way the tide is going.
      wave: (x, t) => 13 * Math.sin(TAU * (x / 1100) - tideDir * t * 0.16 + 1.2),
    },
    {
      name: 'Weather',
      value: weather && sample?.airTempC != null ? `${weather.label}, ${fmtF(sample.airTempC)}` : pending,
      // Drifting cloud: soft, irregular, busier under more cover.
      wave: (x, t) => (5 + cloud * 7) * (0.6 * Math.sin(x / 26 - t * 0.7) + 0.4 * Math.sin(x / 59 + t * 0.45)),
    },
    {
      name: 'Water',
      value: sample?.waterTempC != null ? `${fmtF(sample.waterTempC)} at the surface` : pending,
      // Nearly still.
      wave: (x, t) => 3.5 * Math.sin(x / 38 - t * 0.5),
    },
  ];
}

/** 1 across the signal, easing to 0 where the lines begin to merge. */
function envelope(x: number): number {
  const u = clamp((x - 340) / (SIGNAL_END - 340), 0, 1);
  return 1 - u * u * (3 - 2 * u);
}

function tracePath(lane: Lane, i: number, t: number): string {
  const y0 = LANE_H * (i + 0.5);
  let d = '';
  for (let x = 0; x <= SIGNAL_END; x += STEP) {
    const y = y0 + lane.wave(x, t) * envelope(x);
    d += `${x === 0 ? 'M' : 'L'}${x} ${y.toFixed(2)}`;
  }
  const mid = H / 2;
  return `${d}C${SIGNAL_END + 150} ${y0} ${MERGE_AT - 150} ${mid} ${MERGE_AT} ${mid}L${W} ${mid}`;
}

function Traces({ lanes }: { lanes: Lane[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const paths = useRef<(SVGPathElement | null)[]>([]);
  const lanesRef = useRef(lanes);
  lanesRef.current = lanes;
  const reduced = useReducedMotion();

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const draw = (t: number) =>
      lanesRef.current.forEach((lane, i) => paths.current[i]?.setAttribute('d', tracePath(lane, i, t)));

    if (reduced) {
      draw(0);
      return;
    }
    let frame = 0;
    let running = false;
    const loop = (ms: number) => {
      draw(ms / 1000);
      frame = requestAnimationFrame(loop);
    };
    const observer = new IntersectionObserver(([entry]) => {
      const visible = entry?.isIntersecting ?? false;
      if (visible && !running) frame = requestAnimationFrame(loop);
      if (!visible) cancelAnimationFrame(frame);
      running = visible;
    });
    draw(performance.now() / 1000);
    observer.observe(svg);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [reduced]);

  // Redraw once when the data changes, for reduced motion (the loop picks it up on its own otherwise).
  useEffect(() => {
    if (reduced) lanes.forEach((lane, i) => paths.current[i]?.setAttribute('d', tracePath(lane, i, 0)));
  }, [lanes, reduced]);

  return (
    <div className={styles.traces}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {lanes.map((lane, i) => (
          <path
            key={lane.name}
            ref={(el) => {
              paths.current[i] = el;
            }}
            className={styles.trace}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <span className={styles.node} aria-hidden="true" />
    </div>
  );
}

export function Reading({ analysis }: { analysis: BeachAnalysis | null }) {
  const [ref, seen] = useSeen<HTMLElement>('0px 0px -18% 0px');
  const lanes = useMemo(() => lanesFor(analysis), [analysis]);
  const verdict = analysis?.verdict;

  return (
    <section ref={ref} id="read" className={styles.section} data-seen={seen || undefined}>
      <div className={styles.inner}>
        <div className={styles.head}>
          <Kicker>How it reads</Kicker>
          <h2 className={styles.statement}>
            <span className={styles.muted}>Buoys, tide gauges, and forecasts each tell part of the story.</span>{' '}
            SeaState reads them together and tells you, plainly, what the beach is like.
          </h2>
        </div>

        <div className={styles.diagram}>
          <ul className={styles.lanes}>
            {lanes.map((lane) => (
              <li key={lane.name} className={styles.lane}>
                <span className={styles.laneName}>{lane.name}</span>
                <span className={styles.laneValue}>{lane.value}</span>
              </li>
            ))}
          </ul>
          <Traces lanes={lanes} />
          <div className={styles.read} aria-live="polite">
            <p className={styles.readLabel}>{analysis ? `The read at ${analysis.beach.name}` : 'The read'}</p>
            {verdict ? (
              <p className={styles.readText}>
                {verdict.tone !== 'wait' && <strong>{verdict.eyebrow}. </strong>}
                {verdict.headline}
              </p>
            ) : (
              <div className={styles.readPending} />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
