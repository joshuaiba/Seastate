import { useMemo } from 'react';
import {
  compassToDegrees,
  degreesToCompass,
  HOUR_MS,
  metersToFeet,
  swellExposure,
  swellPhrase,
  trainFaceFt,
  type BeachAnalysis,
  type SurfProfile,
  type SwellComponent,
  type WindQuality,
} from '@seastate/shared';
import { ago } from '../lib/format';
import { useElementWidth } from '../lib/hooks';
import { Section } from './ui/primitives';
import styles from './SurfSection.module.css';

const KIND_LABEL: Record<SwellComponent['kind'], string> = {
  primary: 'Primary swell',
  secondary: 'Secondary swell',
  wind: 'Wind waves',
};

const KIND_COLOR: Record<SwellComponent['kind'], string> = {
  primary: 'var(--q5)',
  secondary: 'var(--q3)',
  wind: 'var(--ink-3)',
};

/**
 * Where the surf is coming from: each wave train on a compass against the beach's real orientation
 * and swell window, how much of it reaches the sand, and what the nearest buoy is measuring.
 */
export function SurfSection({ analysis, now }: { analysis: BeachAnalysis; now: number }) {
  const { beach, conditions } = analysis;
  const surf = analysis.now.scores.surf;
  const swells = analysis.now.sample.swells;
  const windDir = analysis.now.sample.windDirDeg;
  const dominantExposure = surf.surf.dominant ? swellExposure(surf.surf.dominant.dirDeg, beach.surf) : 0;
  const buoy = conditions.buoy;
  const buoyFresh = buoy && now - Date.parse(buoy.time) < 6 * HOUR_MS;

  return (
    <Section id="surf" title="Swell & wind" aside={`${beach.name} faces ${degreesToCompass(beach.surf.facingDeg)}`}>
      <div className={styles.card}>
        <figure className={styles.compassWrap}>
          <SwellCompass profile={beach.surf} swells={swells} wind={surf.wind} windDirDeg={windDir} />
          <figcaption className={styles.legend}>
            <span>
              <i className={styles.keyWindow} /> Swell window
            </span>
            <span>
              <i className={styles.keyShore} /> Shoreline
            </span>
            {surf.wind && windDir !== null && surf.wind.relation !== 'calm' && (
              <span>
                <i className={styles.keyWind} /> Wind
              </span>
            )}
          </figcaption>
        </figure>
        <div className={styles.detail}>
          <p className={styles.lead}>
            {surf.surf.dominant ? (
              <>
                {capitalize(swellPhrase(surf.surf))}.{' '}
                <span className={styles.leadSub}>
                  {dominantExposure > 0.75
                    ? `${beach.name} is wide open to it.`
                    : dominantExposure > 0.4
                      ? `${beach.name} catches part of it.`
                      : dominantExposure > 0
                        ? `Most of it is blocked before it reaches ${beach.name}.`
                        : `It's outside ${beach.name}'s swell window.`}
                </span>
              </>
            ) : (
              'No swell to speak of.'
            )}
          </p>

          <ul className={styles.trains}>
            {swells.map((train) => {
              const exposure = swellExposure(train.dirDeg, beach.surf);
              const face = trainFaceFt(train, beach.surf);
              return (
                <li key={train.kind} className={styles.train}>
                  <span className={styles.trainKey} style={{ background: KIND_COLOR[train.kind] }} />
                  <div className={styles.trainName}>
                    <strong>{KIND_LABEL[train.kind]}</strong>
                    <span>
                      {degreesToCompass(train.dirDeg)} {Math.round(train.dirDeg)}°
                    </span>
                  </div>
                  <div className={styles.trainStat}>
                    <strong>{metersToFeet(train.heightM).toFixed(1)} ft</strong>
                    <span>height</span>
                  </div>
                  <div className={styles.trainStat}>
                    <strong>{Math.round(train.periodS)} s</strong>
                    <span>period</span>
                  </div>
                  <div className={styles.trainReach}>
                    <div className={styles.reachBar}>
                      <div style={{ width: `${Math.round(exposure * 100)}%`, background: KIND_COLOR[train.kind] }} />
                    </div>
                    <span>
                      {Math.round(exposure * 100)}% reaches the beach · {face < 0.3 ? 'negligible' : `~${face.toFixed(1)} ft faces`}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        {buoy && (
          <div className={styles.buoy}>
            <div className={styles.buoyHead}>
              <span>
                Buoy {buoy.station.id} · {buoy.station.name}
              </span>
              <span className={styles.buoyAge} data-stale={!buoyFresh || undefined}>
                Measured {ago(Date.parse(buoy.time), now)}
              </span>
            </div>
            <div className={styles.buoyBody}>
              <dl className={styles.buoyStats}>
                <div>
                  <dt>Wave height</dt>
                  <dd>{buoy.significantHeightM === null ? '—' : `${metersToFeet(buoy.significantHeightM).toFixed(1)} ft`}</dd>
                </div>
                <div>
                  <dt>Swell</dt>
                  <dd>
                    {buoy.swell ? `${metersToFeet(buoy.swell.heightM).toFixed(1)} ft` : '—'}
                    {buoy.swell && (
                      <span>
                        {buoy.swell.periodS ? `${Math.round(buoy.swell.periodS)} s` : ''}
                        {buoy.swell.dirDeg !== null ? ` · ${degreesToCompass(buoy.swell.dirDeg)}` : ''}
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Wind waves</dt>
                  <dd>
                    {buoy.windWave ? `${metersToFeet(buoy.windWave.heightM).toFixed(1)} ft` : '—'}
                    {buoy.windWave?.periodS && <span>{Math.round(buoy.windWave.periodS)} s</span>}
                  </dd>
                </div>
              </dl>
              <BuoySparkline history={buoy.history} />
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

/** Compass with the beach's shoreline, swell window, each wave train, and the wind. */
export function SwellCompass({
  profile,
  swells,
  wind,
  windDirDeg,
  size = 320,
}: {
  profile: SurfProfile;
  swells: SwellComponent[];
  wind: WindQuality | null;
  windDirDeg: number | null;
  size?: number;
}) {
  const c = size / 2;
  const R = size * 0.38;
  const at = (deg: number, r: number): [number, number] => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [c + r * Math.cos(a), c + r * Math.sin(a)];
  };
  const arc = (from: number, to: number, r: number) => {
    const [x1, y1] = at(from, r);
    const [x2, y2] = at(to, r);
    const large = (to - from + 360) % 360 > 180 ? 1 : 0;
    return `M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2}`;
  };
  const maxHeight = Math.max(0.3, ...swells.map((s) => s.heightM));
  const { centerDeg, halfWidthDeg } = profile.swellWindow;
  const [shoreA, shoreB] = [at(profile.facingDeg - 90, R), at(profile.facingDeg + 90, R)];
  const seaSide = `M${shoreA[0]},${shoreA[1]} ${arc(profile.facingDeg - 90, profile.facingDeg + 90, R).replace(/^M[^A]+/, '')} Z`;

  const label = [
    ...swells.map((s) => `${KIND_LABEL[s.kind]} from ${degreesToCompass(s.dirDeg)}, ${metersToFeet(s.heightM).toFixed(1)} feet at ${Math.round(s.periodS)} seconds`),
    wind && windDirDeg !== null ? `wind from ${degreesToCompass(windDirDeg)} at ${Math.round(wind.speedMph)} mph, ${wind.label.toLowerCase()}` : '',
  ]
    .filter(Boolean)
    .join('; ');

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className={styles.compass} role="img" aria-label={`Swell compass: ${label}`}>
      <circle cx={c} cy={c} r={R} fill="rgba(210, 190, 150, 0.05)" />
      <path d={seaSide} fill="rgba(112, 173, 212, 0.08)" />
      <circle cx={c} cy={c} r={R} fill="none" stroke="var(--hairline-strong)" />
      <circle cx={c} cy={c} r={R * 0.5} fill="none" stroke="var(--hairline)" />
      <line x1={shoreA[0]} y1={shoreA[1]} x2={shoreB[0]} y2={shoreB[1]} stroke="rgba(230, 210, 170, 0.45)" strokeWidth="1.5" />

      {/* Swell window */}
      <path d={arc(centerDeg - halfWidthDeg, centerDeg + halfWidthDeg, R + 10)} fill="none" stroke="var(--accent)" strokeOpacity="0.7" strokeWidth="2.5" strokeLinecap="round" />

      {/* Compass ticks */}
      {Array.from({ length: 16 }, (_, i) => {
        const deg = i * 22.5;
        const [x1, y1] = at(deg, R - (i % 4 === 0 ? 8 : 4));
        const [x2, y2] = at(deg, R);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--ink-4)" />;
      })}
      {(['N', 'E', 'S', 'W'] as const).map((p) => {
        const [x, y] = at(compassToDegrees(p), R + 24);
        return (
          <text key={p} x={x} y={y + 4} textAnchor="middle" className={styles.cardinal}>
            {p}
          </text>
        );
      })}

      {/* Wave trains, arriving from their direction toward the beach */}
      {[...swells].reverse().map((s) => {
        const len = 22 + (R - 30) * (s.heightM / maxHeight) * 0.85;
        const [x1, y1] = at(s.dirDeg, R - 2);
        const [x2, y2] = at(s.dirDeg, R - 2 - len);
        const width = s.kind === 'primary' ? 5 : s.kind === 'secondary' ? 3.5 : 2.5;
        const angle = s.dirDeg + 180;
        return (
          <g key={s.kind} className={styles.arrow}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={KIND_COLOR[s.kind]} strokeWidth={width} strokeLinecap="round" />
            <path
              d="M0,-7 L6,4 L-6,4 Z"
              transform={`translate(${x2},${y2}) rotate(${angle})`}
              fill={KIND_COLOR[s.kind]}
            />
            <text {...textAt(at(s.dirDeg + (s.kind === 'secondary' ? 12 : s.kind === 'wind' ? -12 : 0), R + 22))} className={styles.trainLabel}>
              {Math.round(s.periodS)}s
            </text>
          </g>
        );
      })}

      {/* Wind */}
      {wind && windDirDeg !== null && wind.relation !== 'calm' && (
        <g>
          {(() => {
            const [x1, y1] = at(windDirDeg, R * 0.72);
            const [x2, y2] = at(windDirDeg, R * 0.18);
            return (
              <>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--ink-2)" strokeWidth="2" strokeDasharray="1 5" strokeLinecap="round" />
                <path d="M0,-6 L5,4 L-5,4 Z" transform={`translate(${x2},${y2}) rotate(${windDirDeg + 180})`} fill="var(--ink-2)" />
              </>
            );
          })()}
        </g>
      )}

      <circle cx={c} cy={c} r="5" fill="var(--sun)" stroke="var(--surface)" strokeWidth="2" />
    </svg>
  );
}

function textAt([x, y]: [number, number]) {
  return { x, y: y + 4, textAnchor: 'middle' as const };
}

function BuoySparkline({ history }: { history: { ms: number; heightM: number }[] }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const points = useMemo(() => history.slice(-96), [history]);
  const h = 56;
  if (points.length < 3) return <div ref={ref} className={styles.spark} />;
  const lo = Math.min(...points.map((p) => p.heightM));
  const hi = Math.max(...points.map((p) => p.heightM));
  const x = (ms: number) => ((ms - points[0]!.ms) / (points.at(-1)!.ms - points[0]!.ms || 1)) * (width - 8) + 4;
  const y = (m: number) => 8 + (1 - (m - lo) / (hi - lo || 1)) * (h - 18);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.ms).toFixed(1)},${y(p.heightM).toFixed(1)}`).join('');
  const last = points.at(-1)!;
  return (
    <div ref={ref} className={styles.spark}>
      <span className={styles.sparkLabel}>Last {Math.round((last.ms - points[0]!.ms) / HOUR_MS)} h</span>
      {width > 0 && (
        <svg width={width} height={h} role="img" aria-label={`Buoy wave height over the last two days, from ${metersToFeet(lo).toFixed(1)} to ${metersToFeet(hi).toFixed(1)} feet`}>
          <path d={d} fill="none" stroke="var(--q4)" strokeWidth="1.5" strokeLinejoin="round" />
          <circle cx={x(last.ms)} cy={y(last.heightM)} r="4" fill="var(--q5)" stroke="var(--surface)" strokeWidth="2" />
          <text x={4} y={h - 1} className={styles.sparkTick}>
            {metersToFeet(lo).toFixed(1)} ft
          </text>
          <text x={4} y={7} className={styles.sparkTick}>
            {metersToFeet(hi).toFixed(1)} ft
          </text>
        </svg>
      )}
    </div>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
