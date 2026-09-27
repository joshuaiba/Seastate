import { useMemo, type CSSProperties } from 'react';
import {
  DAY_MS,
  metersToFeet,
  startOfLocalDay,
  tideHeightAt,
  type Activity,
  type BeachAnalysis,
  type BeachInfo,
} from '@seastate/shared';
import { clock, fmtF, qualityColor } from '../lib/format';
import { useSeen } from '../lib/hooks';
import { themeFor } from '../theme/beaches';
import { StripMap } from './StripMap';
import { EnterLink, Kicker } from './ui';
import styles from './Coast.module.css';

/** A few words on each beach, shorter than the dashboard's line of character. */
const NOTES: Record<string, string> = {
  'seal-beach': 'Sheltered by the breakwater',
  'huntington-beach': 'Surf City, open to swell',
  'newport-beach': 'Beach breaks down to the Wedge',
};

const ACTIVITY_NAMES: Record<Activity, string> = { surf: 'Surf', run: 'Run', beach: 'Beach' };

/**
 * The three beaches as they are right now, under a chart of the coast they share. A preview, not the
 * dashboard: the surf, today's tide, how each activity rates, and the one-line verdict.
 */
export function Coast({
  beaches,
  byBeach,
  now,
  error,
}: {
  beaches: BeachInfo[];
  byBeach: Record<string, BeachAnalysis>;
  now: number;
  error: Error | null;
}) {
  const [ref, seen] = useSeen<HTMLElement>('0px 0px -15% 0px');

  return (
    <section ref={ref} id="coast" className={styles.section} data-seen={seen || undefined}>
      <div className={styles.inner}>
        <div className={styles.head}>
          <Kicker>Right now</Kicker>
          <h2 className={styles.title}>Three beaches, a few miles apart, and rarely the same day.</h2>
        </div>

        <div className={styles.map}>
          <StripMap beaches={beaches} />
        </div>

        {error ? (
          <p className={styles.error}>
            Live conditions aren't loading right now. The app will have them as soon as they're back.
          </p>
        ) : (
          <div className={styles.columns}>
            {beaches.map((beach, i) => (
              <BeachColumn key={beach.id} beach={beach} analysis={byBeach[beach.id] ?? null} now={now} order={i} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function BeachColumn({
  beach,
  analysis,
  now,
  order,
}: {
  beach: BeachInfo;
  analysis: BeachAnalysis | null;
  now: number;
  order: number;
}) {
  const surf = analysis?.now.scores.surf;
  const [size, unit] = surf ? splitSurfLabel(surf.surf.label) : ['', ''];
  const style = { '--col-accent': themeFor(beach.id).accent, '--order': order } as CSSProperties;

  return (
    <article className={styles.column} style={style}>
      <header className={styles.colHead}>
        <h3 className={styles.name}>{beach.name}</h3>
        <p className={styles.note}>{NOTES[beach.id] ?? beach.region}</p>
      </header>

      {analysis && surf ? (
        <>
          <p className={styles.size}>
            <span className={styles.sizeValue}>{size}</span>
            {unit && <span className={styles.sizeUnit}>{unit}</span>}
          </p>
          <p className={styles.sizeNote}>
            {surf.surf.bodyRef}
            {surf.wind && ` · ${surf.wind.label}`}
            {analysis.now.sample.waterTempC != null && ` · ${fmtF(analysis.now.sample.waterTempC)} water`}
          </p>

          <TideLine analysis={analysis} now={now} />

          <dl className={styles.scores}>
            {(['surf', 'run', 'beach'] as const).map((activity) => {
              const summary = analysis.summaries[activity];
              const score = summary.rated.scores[activity].score;
              return (
                <div key={activity} className={styles.score}>
                  <dt>{ACTIVITY_NAMES[activity]}</dt>
                  <dd>
                    <span className={styles.bar} aria-hidden="true">
                      <span style={{ width: `${Math.max(3, score)}%`, background: qualityColor(score) }} />
                    </span>
                    <span className={styles.scoreLabel}>{summary.label}</span>
                  </dd>
                </div>
              );
            })}
          </dl>

          <p className={styles.verdict}>
            {analysis.verdict.tone !== 'wait' && <strong>{analysis.verdict.eyebrow}. </strong>}
            {analysis.verdict.headline}
          </p>
        </>
      ) : (
        <div className={styles.pending} aria-label={`Loading ${beach.name}`}>
          <span />
          <span />
          <span />
        </div>
      )}

      <div className={styles.colLink}>
        <EnterLink quiet href={`/app/#${encodeURIComponent(beach.id)}`}>
          {`Open ${beach.name}`}
        </EnterLink>
      </div>
    </article>
  );
}

/** "3–4 ft" → ["3–4", "ft"]; "Flat" stays whole. */
function splitSurfLabel(label: string): [string, string] {
  const match = /^(.*?)\s*(ft)$/.exec(label);
  return match ? [match[1]!, match[2]!] : [label, ''];
}

const TIDE_W = 240;
const TIDE_H = 48;

/** Today's tide, midnight to midnight, with where it is now and the next turn. */
function TideLine({ analysis, now }: { analysis: BeachAnalysis; now: number }) {
  const tz = analysis.beach.timezone;
  const tide = analysis.conditions.tide;

  const shape = useMemo(() => {
    const start = startOfLocalDay(now, tz);
    const heights: [number, number][] = [];
    for (let ms = start; ms <= start + DAY_MS; ms += 15 * 60_000) {
      const h = tideHeightAt(tide, ms);
      if (h !== null) heights.push([ms, h]);
    }
    if (heights.length < 2) return null;
    const lo = Math.min(...heights.map((p) => p[1]));
    const hi = Math.max(...heights.map((p) => p[1]));
    const x = (ms: number) => ((ms - start) / DAY_MS) * TIDE_W;
    const y = (h: number) => 4 + (1 - (h - lo) / (hi - lo || 1)) * (TIDE_H - 8);
    const line = heights.map(([ms, h], i) => `${i ? 'L' : 'M'}${x(ms).toFixed(1)} ${y(h).toFixed(1)}`).join('');
    const nowH = tideHeightAt(tide, now);
    return {
      line,
      area: `${line}L${TIDE_W} ${TIDE_H}L0 ${TIDE_H}Z`,
      now: nowH === null ? null : { left: (x(now) / TIDE_W) * 100, top: (y(nowH) / TIDE_H) * 100 },
    };
  }, [tide, now, tz]);

  const nowM = analysis.now.sample.tideM;
  const rising = (analysis.now.sample.tideRateMPerHour ?? 0) >= 0;
  const next = tide.extremes.find((e) => e.ms > now);

  if (!shape) return null;
  return (
    <div className={styles.tide}>
      <div className={styles.tideChart}>
        <svg viewBox={`0 0 ${TIDE_W} ${TIDE_H}`} preserveAspectRatio="none" aria-hidden="true">
          <path d={shape.area} className={styles.tideArea} />
          <path d={shape.line} className={styles.tideLine} vectorEffect="non-scaling-stroke" />
        </svg>
        {shape.now && (
          <span
            className={styles.tideNow}
            style={{ left: `${shape.now.left}%`, top: `${shape.now.top}%` }}
            aria-hidden="true"
          />
        )}
      </div>
      <p className={styles.tideText}>
        {nowM != null && (
          <>
            Tide {metersToFeet(nowM).toFixed(1)} ft, {rising ? 'rising' : 'falling'}
          </>
        )}
        {next && (
          <span className={styles.tideNext}>
            {' '}
            · {next.type === 'high' ? 'High' : 'Low'} at {clock(next.ms, analysis.beach.timezone)}
          </span>
        )}
      </p>
    </div>
  );
}
