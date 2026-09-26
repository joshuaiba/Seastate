import {
  celsiusToFahrenheit,
  degreesToCompass,
  formatClockRange,
  mpsToMph,
  surfRating,
  type Activity,
  type BeachAnalysis,
  type BeachInfo,
  type Comparison,
} from '@seastate/shared';
import { dayLabel, qualityColor, ratingColor } from '../lib/format';
import { Icon } from './ui/Icon';
import { QualityTag, Section } from './ui/primitives';
import styles from './CompareBeaches.module.css';

/** The coast from Long Beach to Crystal Cove, lon/lat, traced roughly from charts. Land is to the north. */
const COAST: [number, number][] = [
  [-118.3, 33.763], [-118.2, 33.765], [-118.16, 33.758], [-118.135, 33.752], [-118.118, 33.745],
  [-118.1, 33.738], [-118.085, 33.727], [-118.065, 33.713], [-118.04, 33.69], [-118.02, 33.672],
  [-118.005, 33.657], [-117.98, 33.638], [-117.955, 33.625], [-117.93, 33.609], [-117.9, 33.599],
  [-117.882, 33.592], [-117.87, 33.596], [-117.86, 33.589], [-117.84, 33.575], [-117.82, 33.565],
  [-117.79, 33.548], [-117.75, 33.52],
];
const BREAKWATER: [number, number][] = [
  [-118.235, 33.716], [-118.19, 33.722], [-118.135, 33.727],
];

const ACTIVITY_LABEL: Record<Activity, string> = { surf: 'Surf', run: 'Run', beach: 'Beach' };

/**
 * "Which of my beaches is best today?" A map of the coast with each beach's surf, and a card per
 * beach, flagged where it's the pick for surfing, running, or hanging out.
 */
export function CompareBeaches({
  beaches,
  analyses,
  comparison,
  selectedId,
  onSelect,
}: {
  beaches: BeachInfo[];
  analyses: Record<string, BeachAnalysis>;
  comparison: Comparison | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (beaches.length < 2) return null;
  const choose = (id: string) => {
    onSelect(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <Section id="compare" eyebrow="Compare" title="Your beaches today" aside="Judged on the rest of today">
      <div className={styles.layout}>
        <CoastMap beaches={beaches} analyses={analyses} comparison={comparison} selectedId={selectedId} onSelect={choose} />
        <div className={styles.cards}>
          {beaches.map((beach) => {
            const a = analyses[beach.id];
            const picks = (['surf', 'run', 'beach'] as const).filter((act) => comparison?.bestFor[act] === beach.id);
            const standing = comparison?.standings.find((s) => s.beachId === beach.id);
            return (
              <button
                key={beach.id}
                type="button"
                className={styles.card}
                data-selected={beach.id === selectedId || undefined}
                onClick={() => choose(beach.id)}
                aria-label={`Show ${beach.name}`}
              >
                <span className={styles.cardHead}>
                  <strong>{beach.name}</strong>
                  {beach.id === selectedId && <span className={styles.viewing}>Viewing</span>}
                </span>
                {a ? (
                  <>
                    <span className={styles.surfLine}>
                      <span className={styles.surfValue}>{a.now.scores.surf.surf.label}</span>
                      <QualityTag label={surfRating(standing?.outlook.surf ?? a.now.scores.surf.score).label} color={ratingColor(surfRating(standing?.outlook.surf ?? a.now.scores.surf.score).id)} />
                    </span>
                    <span className={styles.facts}>
                      <span>
                        <Icon name="wind" size={14} />
                        {a.now.sample.windSpeedMps === null ? '—' : `${Math.round(mpsToMph(a.now.sample.windSpeedMps))} mph ${a.now.sample.windDirDeg === null ? '' : degreesToCompass(a.now.sample.windDirDeg)}`}
                        {a.now.scores.surf.wind && <em> · {a.now.scores.surf.wind.label.toLowerCase()}</em>}
                      </span>
                      <span>
                        <Icon name="drop" size={14} />
                        {a.now.sample.waterTempC === null ? '—' : `${Math.round(celsiusToFahrenheit(a.now.sample.waterTempC))}°F water`}
                      </span>
                      <span>
                        <Icon name="clock" size={14} />
                        {a.upcoming.surf
                          ? `Surf ${formatClockRange(a.upcoming.surf.window.startMs, a.upcoming.surf.window.endMs, beach.timezone)}${a.upcoming.surf.dayOffset ? ` ${dayLabel(a.upcoming.surf.window.startMs, beach.timezone, 1).toLowerCase()}` : ''}`
                          : 'No standout surf window'}
                      </span>
                    </span>
                    {standing && (
                      <span className={styles.scores}>
                        {(['surf', 'run', 'beach'] as const).map((act) => (
                          <span key={act} className={styles.score}>
                            <span className={styles.scoreBar}>
                              <span style={{ width: `${Math.max(4, standing.outlook[act])}%`, background: qualityColor(standing.outlook[act]) }} />
                            </span>
                            {ACTIVITY_LABEL[act]}
                          </span>
                        ))}
                      </span>
                    )}
                    {picks.length > 0 && (
                      <span className={styles.picks}>
                        {picks.map((p) => (
                          <span key={p} className={styles.pick}>
                            <Icon name="spark" size={12} /> Best for {p === 'surf' ? 'surf' : p === 'run' ? 'a run' : 'the beach'}
                          </span>
                        ))}
                      </span>
                    )}
                  </>
                ) : (
                  <span className={styles.loading}>Loading…</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </Section>
  );
}

function CoastMap({
  beaches,
  analyses,
  comparison,
  selectedId,
  onSelect,
}: {
  beaches: BeachInfo[];
  analyses: Record<string, BeachAnalysis>;
  comparison: Comparison | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const W = 520;
  const H = 360;
  const lats = beaches.map((b) => b.lat);
  const lons = beaches.map((b) => b.lon);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);
  // Fit the beaches with room around them, keeping true proportions.
  const spanLon = Math.max(0.2, (Math.max(...lons) - Math.min(...lons)) * 1.65);
  const spanLat = Math.max((spanLon * kx * H) / W, (Math.max(...lats) - Math.min(...lats)) * 2.2);
  const lonMid = (Math.min(...lons) + Math.max(...lons)) / 2;
  const x = (lon: number) => ((lon - (lonMid - spanLon / 2)) / spanLon) * W;
  const y = (lat: number) => ((midLat + spanLat / 2 - lat) / spanLat) * H;
  const coast = COAST.map(([lon, lat], i) => `${i ? 'L' : 'M'}${x(lon).toFixed(1)},${y(lat).toFixed(1)}`).join('');
  const land = `${coast}L${x(COAST.at(-1)![0])},${-H}L${x(COAST[0]![0])},${-H}Z`;
  const breakwater = BREAKWATER.map(([lon, lat], i) => `${i ? 'L' : 'M'}${x(lon).toFixed(1)},${y(lat).toFixed(1)}`).join('');

  return (
    <div className={styles.map}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Map of your beaches with today's surf">
        <defs>
          <linearGradient id="sea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="rgba(92,194,230,0.10)" />
            <stop offset="1" stopColor="rgba(92,194,230,0.02)" />
          </linearGradient>
        </defs>
        <rect x={-W} y={-H} width={W * 3} height={H * 3} fill="url(#sea)" />
        {/* Bathymetry-ish contours: the coast repeated offshore */}
        {[14, 30, 50].map((d, i) => (
          <path key={d} d={coast} transform={`translate(${-d * 0.55},${d})`} fill="none" stroke="rgba(92,194,230,0.12)" strokeOpacity={0.9 - i * 0.25} strokeDasharray="2 6" />
        ))}
        <path d={land} fill="rgba(210, 190, 150, 0.07)" />
        <path d={coast} fill="none" stroke="rgba(230, 210, 170, 0.45)" strokeWidth="1.5" strokeLinejoin="round" />
        <path d={breakwater} fill="none" stroke="rgba(230, 210, 170, 0.35)" strokeWidth="2.5" strokeLinecap="round" />
        {x(-118.135) > 170 && (
          <text x={x(-118.135) - 8} y={y(33.727) + 18} textAnchor="end" className={styles.mapNote}>
            Long Beach breakwater
          </text>
        )}
        <text x={W - 16} y={H - 16} textAnchor="end" className={styles.mapNote}>
          Pacific Ocean
        </text>

        {beaches.map((beach) => {
          const a = analyses[beach.id];
          const score = comparison?.standings.find((s) => s.beachId === beach.id)?.outlook.surf ?? 0;
          const cx = x(beach.lon);
          const cy = y(beach.lat);
          const selected = beach.id === selectedId;
          return (
            <g
              key={beach.id}
              className={styles.marker}
              data-selected={selected || undefined}
              onClick={() => onSelect(beach.id)}
              role="button"
              tabIndex={0}
              aria-label={`${beach.name}: ${a?.now.scores.surf.surf.label ?? 'loading'}`}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(beach.id)}
            >
              <circle cx={cx} cy={cy} r="22" fill="transparent" />
              {selected && <circle cx={cx} cy={cy} r="14" className={styles.pulse} />}
              <circle cx={cx} cy={cy} r={selected ? 7 : 6} fill={a ? ratingColor(surfRating(score).id) : 'var(--ink-4)'} stroke="var(--surface)" strokeWidth="2.5" />
              <text x={cx > W * 0.62 ? cx - 14 : cx + 14} y={cy + 22} textAnchor={cx > W * 0.62 ? 'end' : 'start'} className={styles.markerName}>
                {beach.name}
              </text>
              <text x={cx > W * 0.62 ? cx - 14 : cx + 14} y={cy + 38} textAnchor={cx > W * 0.62 ? 'end' : 'start'} className={styles.markerValue}>
                {a ? `${a.now.scores.surf.surf.label} · ${surfRating(score).label.toLowerCase()}` : '…'}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
