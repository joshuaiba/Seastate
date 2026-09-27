import { useMemo, type ReactNode } from 'react';
import {
  clamp,
  DAY_MS,
  formatClock,
  formatClockRange,
  startOfLocalDay,
  type Activity,
  type BeachAnalysis,
  type BeachInfo,
} from '@seastate/shared';
import { dayLabel } from '../lib/format';
import { useReducedMotion, useSeen } from '../lib/hooks';
import { Kicker } from './ui';
import styles from './BuiltFor.module.css';

interface Row {
  activity: Activity;
  title: string;
  text: string;
  art: (animate: boolean) => ReactNode;
}

const ROWS: Row[] = [
  {
    activity: 'surf',
    title: 'Surfing',
    text: 'Swell size, period, wind, and tide, read against the way each beach faces.',
    art: (animate) => <SurfArt animate={animate} />,
  },
  {
    activity: 'run',
    title: 'Running',
    text: 'Cool air, soft light, and a quiet wind, found hour by hour along the sand.',
    art: (animate) => <RunArt animate={animate} />,
  },
  {
    activity: 'beach',
    title: 'Beach days',
    text: 'Warm air, sunshine, and a calm breeze, and the hours worth spending in them.',
    art: (animate) => <BeachArt animate={animate} />,
  },
];

/**
 * Who it's for, one horizon-wide band per activity: the name, a small moving drawing, a line on what
 * SeaState weighs, and the next good window anywhere on the coast, from the live data.
 */
export function BuiltFor({
  beaches,
  byBeach,
  now,
}: {
  beaches: BeachInfo[];
  byBeach: Record<string, BeachAnalysis>;
  now: number;
}) {
  const [ref, seen] = useSeen<HTMLElement>('0px 0px -15% 0px');
  const reduced = useReducedMotion();
  const loaded = beaches.some((b) => byBeach[b.id]);

  return (
    <section ref={ref} id="built-for" className={styles.section} data-seen={seen || undefined}>
      <div className={styles.inner}>
        <div className={styles.head}>
          <Kicker>Built for</Kicker>
          <h2 className={styles.title}>Whatever brings you down to the water.</h2>
        </div>
        <ol className={styles.rows}>
          {ROWS.map((row, i) => (
            <li key={row.activity} className={styles.row} style={{ transitionDelay: `${i * 120}ms` }}>
              <h3 className={styles.rowTitle}>{row.title}</h3>
              <div className={styles.art} aria-hidden="true">
                {row.art(!reduced)}
              </div>
              <div className={styles.copy}>
                <p className={styles.text}>{row.text}</p>
                <NextWindow activity={row.activity} beaches={beaches} byBeach={byBeach} loaded={loaded} now={now} />
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** The best upcoming window for an activity across every beach. */
function NextWindow({
  activity,
  beaches,
  byBeach,
  loaded,
  now,
}: {
  activity: Activity;
  beaches: BeachInfo[];
  byBeach: Record<string, BeachAnalysis>;
  loaded: boolean;
  now: number;
}) {
  const best = useMemo(() => {
    let top: { beach: BeachInfo; analysis: BeachAnalysis } | null = null;
    for (const beach of beaches) {
      const analysis = byBeach[beach.id];
      const w = analysis?.upcoming[activity];
      if (!analysis || !w) continue;
      if (!top || w.window.peakScore > top.analysis.upcoming[activity]!.window.peakScore) top = { beach, analysis };
    }
    return top;
  }, [activity, beaches, byBeach]);

  if (!loaded) return <div className={styles.window} />;
  if (!best) return <p className={styles.windowNone}>Nothing worth recommending in the forecast just yet.</p>;

  const insight = best.analysis.upcoming[activity]!;
  const tz = best.beach.timezone;
  const { startMs, endMs } = insight.window;
  const day = dayLabel(startMs, tz, insight.dayOffset, 'long');
  const dayStart = startOfLocalDay(startMs, tz);
  const at = (ms: number) => clamp(((ms - dayStart) / DAY_MS) * 100, 0, 100);

  return (
    <div className={styles.window}>
      <p className={styles.windowHead}>
        <span>{insight.active ? 'Good now' : 'Next window'}</span>
        <span>{best.beach.name}</span>
      </p>
      <p className={styles.windowTime}>
        {insight.active ? `Until ${formatClock(endMs, tz)}` : `${day}, ${formatClockRange(startMs, endMs, tz)}`}
      </p>
      {/* The window on a day's ruler, midnight to midnight, like a line in a tide table. */}
      <div className={styles.ruler} aria-hidden="true">
        {[3, 6, 9, 12, 15, 18, 21].map((h) => (
          <span
            key={h}
            className={h % 6 === 0 ? styles.tickMajor : styles.tick}
            style={{ left: `${(h / 24) * 100}%` }}
          />
        ))}
        <span className={styles.span} style={{ left: `${at(startMs)}%`, width: `${at(endMs) - at(startMs)}%` }} />
        {insight.dayOffset === 0 && <span className={styles.now} style={{ left: `${at(now)}%` }} />}
      </div>
      <div className={styles.rulerLabels} aria-hidden="true">
        <span style={{ left: '25%' }}>6a</span>
        <span style={{ left: '50%' }}>12p</span>
        <span style={{ left: '75%' }}>6p</span>
      </div>
    </div>
  );
}

/* The drawings: 400 × 140, hairline strokes, one lit element each. */

function wavePath(y: number, amp: number, period: number, width = 800): string {
  let d = `M0 ${y}`;
  for (let x = 0; x < width; x += period) {
    d += `q${period / 4} ${-amp} ${period / 2} 0t${period / 2} 0`;
  }
  return d;
}

/** Swell lines marching in from the horizon, closer together and slower toward it. */
function SurfArt({ animate }: { animate: boolean }) {
  const lines = [
    { y: 44, amp: 1.5, period: 50, dur: 16, opacity: 0.3 },
    { y: 64, amp: 3, period: 80, dur: 12, opacity: 0.45 },
    { y: 90, amp: 5, period: 120, dur: 9, opacity: 0.6 },
    { y: 122, amp: 8, period: 200, dur: 7, opacity: 1 },
  ];
  return (
    <svg viewBox="0 0 400 140" className={styles.svg}>
      <line x1="0" y1="28" x2="400" y2="28" className={styles.horizon} />
      {lines.map((l, i) => (
        <path
          key={i}
          d={wavePath(l.y, l.amp, l.period)}
          className={i === lines.length - 1 ? styles.lit : styles.stroke}
          style={{
            opacity: l.opacity,
            animation: animate ? `${styles.march} ${l.dur}s linear infinite` : undefined,
            ['--period' as string]: `${-l.period}px`,
          }}
        />
      ))}
    </svg>
  );
}

/** The waterline, the swash sliding up and back, and a runner keeping an even pace along the firm sand. */
function RunArt({ animate }: { animate: boolean }) {
  return (
    <svg viewBox="0 0 400 140" className={styles.svg}>
      <line x1="0" y1="28" x2="400" y2="28" className={styles.horizon} />
      <path d="M0 70 C80 64 160 76 240 68 S360 66 400 70" className={styles.stroke} style={{ opacity: 0.35 }} />
      <path
        d="M0 88 C70 80 150 96 230 86 S350 84 400 90"
        className={styles.stroke}
        style={{ animation: animate ? `${styles.swash} 7s ease-in-out infinite` : undefined }}
      />
      <line x1="0" y1="112" x2="400" y2="112" className={styles.pace} />
      {[40, 120, 200, 280, 360].map((x) => (
        <line key={x} x1={x} y1="108" x2={x} y2="116" className={styles.tick} />
      ))}
      <circle r="4" cx={animate ? 0 : 214} cy="112" className={styles.runner}>
        {animate && <animate attributeName="cx" from="-8" to="408" dur="11s" repeatCount="indefinite" />}
      </circle>
    </svg>
  );
}

/** The sun's arc over the day, crossing slowly, with its path on the water. */
function BeachArt({ animate }: { animate: boolean }) {
  const arc = 'M40 110 A160 96 0 0 1 360 110';
  return (
    <svg viewBox="0 0 400 140" className={styles.svg}>
      <path d={arc} className={styles.arc} />
      <line x1="0" y1="110" x2="400" y2="110" className={styles.stroke} style={{ opacity: 0.6 }} />
      {[118, 124, 130].map((y, i) => (
        <line key={y} x1={170 + i * 6} y1={y} x2={230 - i * 6} y2={y} className={styles.glint} />
      ))}
      <circle r="7" cx={animate ? 0 : 200} cy={animate ? 0 : 14} className={styles.sun}>
        {animate && <animateMotion dur="26s" repeatCount="indefinite" path={arc} />}
      </circle>
    </svg>
  );
}
