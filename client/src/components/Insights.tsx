import { useState, type ReactNode } from 'react';
import {
  celsiusToFahrenheit,
  mpsToMph,
  surfRating,
  zonedParts,
  type BeachInfo,
  type HistorySummary,
  type Season,
} from '@seastate/shared';
import { useHistory } from '../data/useHistory';
import { qualityColor, ratingColor } from '../lib/format';
import { useSeen } from '../lib/hooks';
import { Section, Skeleton } from './ui/primitives';
import styles from './Insights.module.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SEASON_LABEL: Record<Season, string> = { winter: 'Winter', spring: 'Spring', summer: 'Summer', fall: 'Fall' };

/**
 * History and patterns for the beach: surf by month, good days, the daily wind cycle, where swell
 * comes from, water temperature, and the best time of day. Everything is drawn from the history API,
 * which today serves modeled data and later will serve SeaState's own recorded observations.
 */
export function Insights({ beach, now }: { beach: BeachInfo; now: number }) {
  const [ref, seen] = useSeen<HTMLDivElement>('600px');
  const { history: showing, error } = useHistory(beach.id, seen);

  return (
    <Section
      id="insights"
      title="Patterns & history"
      aside={showing && (showing.provenance === 'synthetic' ? 'Modeled from regional climatology' : 'Recorded by SeaState')}
    >
      <div ref={ref}>
        {error && <p className={styles.error}>History isn't available right now: {error.message}</p>}
        {!showing && !error && (
          <div className={styles.grid}>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className={styles.card}>
                <Skeleton width="40%" height={14} />
                <Skeleton width="70%" height={22} />
                <Skeleton height={160} />
              </div>
            ))}
          </div>
        )}
        {showing && (
          <div className={styles.grid} data-refreshing={showing.beachId !== beach.id || undefined}>
            <SurfByMonth history={showing} beach={beach} now={now} />
            <GoodDays history={showing} />
            <WindCycle history={showing} />
            <SwellRose history={showing} beach={beach} />
            <WaterTemperature history={showing} />
            <BestTime history={showing} />
            <Seasons history={showing} />
          </div>
        )}
        {showing?.provenance === 'synthetic' && (
          <p className={styles.footnote}>
            SeaState hasn't recorded a year of its own observations yet, so these charts use a year of modeled conditions built
            from Southern California climatology and run through the same scoring as the live forecast. Recorded history replaces
            it without any change here.
          </p>
        )}
      </div>
    </Section>
  );
}

function Card({ title, headline, children, wide }: { title: string; headline: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <article className={styles.card} data-wide={wide || undefined}>
      <p className={styles.cardTitle}>{title}</p>
      <p className={styles.headline}>{headline}</p>
      {children}
    </article>
  );
}

/** A floating readout for bars and cells. */
function useTip() {
  const [tip, setTip] = useState<{ x: number; y: number; text: ReactNode } | null>(null);
  const bind = (text: ReactNode) => ({
    onPointerEnter: (e: React.PointerEvent<SVGElement>) => place(e, text),
    onPointerMove: (e: React.PointerEvent<SVGElement>) => place(e, text),
    onPointerLeave: () => setTip(null),
  });
  const place = (e: React.PointerEvent<SVGElement>, text: ReactNode) => {
    const box = (e.currentTarget.ownerSVGElement ?? e.currentTarget).parentElement!.getBoundingClientRect();
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top, text });
  };
  const node = tip && (
    <div className={styles.tip} style={{ left: tip.x, top: tip.y }} role="status">
      {tip.text}
    </div>
  );
  return { bind, node };
}

function SurfByMonth({ history, beach, now }: { history: HistorySummary; beach: BeachInfo; now: number }) {
  const { bind, node } = useTip();
  const current = zonedParts(now, beach.timezone).month - 1;
  const top = Math.max(4, Math.ceil(Math.max(...history.months.map((m) => m.surfFtP75 ?? 0)) + 0.5));
  const best = [...history.months].sort((a, b) => b.goodDays / (b.days || 1) - a.goodDays / (a.days || 1))[0];
  const W = 360;
  const H = 180;
  const gutter = 30;
  const band = (W - gutter) / 12;
  const y = (ft: number) => 10 + (1 - ft / top) * (H - 34);
  return (
    <Card
      title="Surf by month"
      headline={
        best ? (
          <>
            Most consistent in <strong>{MONTHS[best.month]}</strong>, with good surf{' '}
            {Math.round((best.goodDays / (best.days || 1)) * 100)}% of days
          </>
        ) : (
          '—'
        )
      }
    >
      <div className={styles.chart}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Typical surf height by month, ${history.months.map((m) => `${MONTHS[m.month]} ${m.surfFtMean?.toFixed(1)} feet`).join(', ')}`}>
          {[0, top / 2, top].map((t) => (
            <g key={t}>
              <line x1={gutter} x2={W} y1={y(t)} y2={y(t)} stroke="var(--hairline)" />
              <text x={0} y={y(t) + 3.5} className={styles.axis}>
                {t} ft
              </text>
            </g>
          ))}
          {history.months.map((m) => {
            const cx = gutter + band * m.month + band / 2;
            const lo = m.surfFtP25 ?? 0;
            const hi = m.surfFtP75 ?? 0;
            const on = m.month === current;
            return (
              <g key={m.month} {...bind(<><strong>{MONTHS[m.month]}</strong> typical {lo.toFixed(1)}–{hi.toFixed(1)} ft · {m.goodDays} good days</>)}>
                <rect x={cx - band / 2} y={0} width={band} height={H} fill="transparent" />
                <rect x={cx - 6} y={y(hi)} width={12} height={Math.max(4, y(lo) - y(hi))} rx={2} fill={on ? 'var(--accent)' : 'var(--q3)'} opacity={on ? 1 : 0.6} />
                <circle cx={cx} cy={y(m.surfFtMean ?? 0)} r={4} fill="var(--ink)" stroke="var(--surface)" strokeWidth={2} />
                <text x={cx} y={H - 6} textAnchor="middle" className={on ? styles.axisOn : styles.axis}>
                  {MONTHS[m.month]!.charAt(0)}
                </text>
              </g>
            );
          })}
        </svg>
        {node}
      </div>
      <p className={styles.legend}>
        <span className={styles.keyBar} /> middle half of days <span className={styles.keyDot} /> average
      </p>
    </Card>
  );
}

function GoodDays({ history }: { history: HistorySummary }) {
  const { bind, node } = useTip();
  const days = history.days.slice(-26 * 7);
  const good = days.filter((d) => d.good).length;
  const recent = history.days.slice(-30).filter((d) => d.good).length;
  const cell = 12;
  const gap = 2;
  const first = days[0] ? new Date(`${days[0].date}T12:00:00Z`).getUTCDay() : 0;
  const cols = Math.ceil((days.length + first) / 7);
  const W = cols * (cell + gap);
  const H = 7 * (cell + gap);
  return (
    <Card
      title="Good surf days"
      headline={
        <>
          <strong>{good}</strong> good days in the last six months · {recent} in the last 30
        </>
      }
    >
      <div className={styles.chart}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${good} days with good surf in the last six months`}>
          {days.map((d, i) => {
            const index = i + first;
            const col = Math.floor(index / 7);
            const row = index % 7;
            const rating = surfRating(d.bestScore);
            return (
              <rect
                key={d.date}
                x={col * (cell + gap)}
                y={row * (cell + gap)}
                width={cell}
                height={cell}
                rx={2}
                fill={ratingColor(rating.id)}
                opacity={d.good ? 1 : 0.55}
                {...bind(<><strong>{d.date}</strong> {rating.label.toLowerCase()} · up to {d.surfFtMax.toFixed(1)} ft</>)}
              />
            );
          })}
        </svg>
        {node}
      </div>
      <p className={styles.legend}>
        Each square is a day, colored by its best surf.
        <span className={styles.scale}>
          {[0, 1, 2, 3, 4, 5, 6].map((q) => (
            <i key={q} style={{ background: `var(--q${q})` }} />
          ))}
        </span>
        flat → epic
      </p>
    </Card>
  );
}

function WindCycle({ history }: { history: HistorySummary }) {
  const { bind, node } = useTip();
  const hours = history.windByHour;
  const top = Math.max(...hours.map((h) => mpsToMph(h.speedMpsMean ?? 0))) * 1.1;
  const breeze = hours.find((h) => h.hour >= 8 && h.onshoreShare > 0.5);
  const peak = hours.reduce((a, b) => ((b.speedMpsMean ?? 0) > (a.speedMpsMean ?? 0) ? b : a));
  const W = 360;
  const H = 170;
  const band = W / 24;
  const y = (mph: number) => 8 + (1 - mph / top) * (H - 30);
  const hourLabel = (h: number) => (h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`);
  return (
    <Card
      title="Wind through the day"
      headline={
        breeze ? (
          <>
            Cleanest before <strong>{hourLabel(breeze.hour)}m</strong>; the sea breeze peaks around {hourLabel(peak.hour)}m at{' '}
            {Math.round(mpsToMph(peak.speedMpsMean ?? 0))} mph
          </>
        ) : (
          'Light and variable most of the day'
        )
      }
    >
      <div className={styles.chart}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Average wind by hour, peaking at ${Math.round(mpsToMph(peak.speedMpsMean ?? 0))} mph around ${hourLabel(peak.hour)}m`}>
          {hours.map((h) => {
            const mph = mpsToMph(h.speedMpsMean ?? 0);
            const x = h.hour * band + 2;
            return (
              <g key={h.hour} {...bind(<><strong>{hourLabel(h.hour)}m</strong> {mph.toFixed(0)} mph avg · clean {Math.round(h.cleanShare * 100)}% · onshore {Math.round(h.onshoreShare * 100)}%</>)}>
                <rect x={h.hour * band} y={0} width={band} height={H} fill="transparent" />
                <rect x={x} y={y(mph)} width={band - 4} height={Math.max(2, y(0) - y(mph))} rx={2} fill={qualityColor(h.cleanShare * 100)} />
              </g>
            );
          })}
          <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="var(--hairline-strong)" />
          {[0, 6, 12, 18].map((h) => (
            <text key={h} x={h * band + 2} y={H - 4} className={styles.axis}>
              {hourLabel(h)}
            </text>
          ))}
        </svg>
        {node}
      </div>
      <p className={styles.legend}>Bar height is average speed; brighter bars are hours more often glassy or offshore.</p>
    </Card>
  );
}

function SwellRose({ history, beach }: { history: HistorySummary; beach: BeachInfo }) {
  const { bind, node } = useTip();
  const bins = history.swellRose;
  const top = Math.max(...bins.map((b) => b.share), 0.01);
  const ranked = [...bins].sort((a, b) => b.share - a.share);
  const S = 220;
  const c = S / 2;
  const R = S * 0.42;
  const at = (deg: number, r: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [c + r * Math.cos(a), c + r * Math.sin(a)] as const;
  };
  const wedge = (deg: number, r: number) => {
    const [x1, y1] = at(deg - 10, r);
    const [x2, y2] = at(deg + 10, r);
    return `M${c},${c} L${x1},${y1} A${r},${r} 0 0 1 ${x2},${y2} Z`;
  };
  const [fx, fy] = at(beach.surf.facingDeg, R + 6);
  return (
    <Card
      title="Where the swell comes from"
      headline={
        <>
          <strong>{Math.round(((ranked[0]?.share ?? 0) + (ranked[1]?.share ?? 0)) * 100)}%</strong> of hours from {ranked[0]?.point} and {ranked[1]?.point}
        </>
      }
    >
      <div className={`${styles.chart} ${styles.center}`}>
        <svg viewBox={`0 0 ${S} ${S}`} className={styles.rose} role="img" aria-label={`Swell direction distribution; most common ${ranked.slice(0, 3).map((b) => `${b.point} ${Math.round(b.share * 100)} percent`).join(', ')}`}>
          {[0.33, 0.66, 1].map((k) => (
            <circle key={k} cx={c} cy={c} r={R * k} fill="none" stroke="var(--hairline)" />
          ))}
          {bins.map((b) =>
            b.share > 0 ? (
              <path
                key={b.point}
                d={wedge(b.dirDeg, Math.max(3, R * Math.sqrt(b.share / top)))}
                fill="var(--q4)"
                fillOpacity={0.75}
                stroke="var(--surface)"
                strokeWidth={1.5}
                {...bind(<><strong>{b.point}</strong> {Math.round(b.share * 100)}% of hours · avg {b.heightFtMean?.toFixed(1) ?? '—'} ft</>)}
              />
            ) : null,
          )}
          <line x1={c} y1={c} x2={fx} y2={fy} stroke="var(--sun)" strokeWidth="1.5" />
          <circle cx={fx} cy={fy} r="3" fill="var(--sun)" />
          {(['N', 'E', 'S', 'W'] as const).map((p, i) => {
            const [x, y] = at(i * 90, R + 16);
            return (
              <text key={p} x={x} y={y + 4} textAnchor="middle" className={styles.axis}>
                {p}
              </text>
            );
          })}
        </svg>
        {node}
      </div>
      <p className={styles.legend}>
        <span className={styles.keyLine} /> the way {beach.name} faces
      </p>
    </Card>
  );
}

function WaterTemperature({ history }: { history: HistorySummary }) {
  const days = history.days.filter((d) => d.waterTempCMean !== null);
  if (days.length < 10) return null;
  const temps = days.map((d) => celsiusToFahrenheit(d.waterTempCMean!));
  const lo = Math.floor(Math.min(...temps)) - 1;
  const hi = Math.ceil(Math.max(...temps)) + 1;
  const warmest = days[temps.indexOf(Math.max(...temps))]!;
  const coldest = days[temps.indexOf(Math.min(...temps))]!;
  const W = 720;
  const H = 150;
  const x = (i: number) => (i / (days.length - 1)) * W;
  const y = (f: number) => 8 + (1 - (f - lo) / (hi - lo)) * (H - 30);
  const d = temps.map((t, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(t).toFixed(1)}`).join('');
  const monthName = (date: string) => MONTHS[Number(date.slice(5, 7)) - 1];
  const last = temps.at(-1)!;
  return (
    <Card
      wide
      title="Water temperature"
      headline={
        <>
          Warmest around <strong>{Math.round(Math.max(...temps))}°F</strong> in {monthName(warmest.date)}, coldest{' '}
          {Math.round(Math.min(...temps))}°F in {monthName(coldest.date)}
          {history.provenance === 'recorded' && <> · lately {Math.round(last)}°F</>}
        </>
      }
    >
      <div className={styles.chart}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={styles.wide} role="img" aria-label="Daily mean water temperature over the past year">
          <defs>
            <linearGradient id="waterTemp" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--tide)" stopOpacity="0.25" />
              <stop offset="1" stopColor="var(--tide)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[lo + 2, (lo + hi) / 2, hi - 2].map((t) => (
            <line key={t} x1="0" x2={W} y1={y(t)} y2={y(t)} stroke="var(--hairline)" vectorEffect="non-scaling-stroke" />
          ))}
          <path d={`${d}L${W},${H - 22}L0,${H - 22}Z`} fill="url(#waterTemp)" />
          <path d={d} fill="none" stroke="var(--tide)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
        <div className={styles.months}>
          {days
            .filter((day) => day.date.endsWith('-01'))
            .map((day) => (
              <span key={day.date} style={{ left: `${(days.indexOf(day) / (days.length - 1)) * 100}%` }}>
                {monthName(day.date)}
              </span>
            ))}
        </div>
        <span className={styles.nowDot} style={{ top: `${(y(last) / H) * 100}%` }} />
      </div>
    </Card>
  );
}

function BestTime({ history }: { history: HistorySummary }) {
  const { bind, node } = useTip();
  const hours = Array.from({ length: 15 }, (_, i) => i + 5);
  let best = { month: 0, hour: 0, score: -1 };
  history.surfByMonthHour.forEach((row, month) =>
    row.forEach((score, hour) => {
      if (score !== null && score > best.score) best = { month, hour, score };
    }),
  );
  const cellW = 22;
  const cellH = 13;
  const W = 34 + hours.length * cellW;
  const H = 12 * cellH + 20;
  const hourLabel = (h: number) => (h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`);
  return (
    <Card
      title="Best time of day"
      headline={
        <>
          Historically best around <strong>{hourLabel(best.hour)}m</strong> in {MONTHS[best.month]}
        </>
      }
    >
      <div className={styles.chart}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Average surf score by month and hour; best around ${hourLabel(best.hour)}m in ${MONTHS[best.month]}`}>
          {history.surfByMonthHour.map((row, month) => (
            <g key={month}>
              <text x={0} y={month * cellH + 10} className={styles.axisSmall}>
                {MONTHS[month]}
              </text>
              {hours.map((hour, i) => {
                const score = row[hour];
                return (
                  <rect
                    key={hour}
                    x={34 + i * cellW}
                    y={month * cellH}
                    width={cellW - 2}
                    height={cellH - 2}
                    rx={2.5}
                    fill={score === null || score === undefined ? 'rgba(190,228,245,0.04)' : qualityColor(score)}
                    {...bind(
                      <>
                        <strong>
                          {MONTHS[month]} {hourLabel(hour)}m
                        </strong>{' '}
                        {score == null ? 'dark' : `${surfRating(score).label.toLowerCase()} on average`}
                      </>,
                    )}
                  />
                );
              })}
            </g>
          ))}
          {hours
            .filter((h) => h % 3 === 0)
            .map((h) => (
              <text key={h} x={34 + (h - 5) * cellW + cellW / 2} y={H - 4} textAnchor="middle" className={styles.axisSmall}>
                {hourLabel(h)}
              </text>
            ))}
        </svg>
        {node}
      </div>
    </Card>
  );
}

function Seasons({ history }: { history: HistorySummary }) {
  return (
    <Card title="By season" headline="How the year usually plays out" wide>
      <div className={styles.seasons}>
        {history.seasons.map((s) => (
          <div key={s.season} className={styles.season}>
            <p className={styles.seasonName}>{SEASON_LABEL[s.season]}</p>
            <dl>
              <div>
                <dt>Typical surf</dt>
                <dd>{s.surfFtMean === null ? '—' : `${s.surfFtMean.toFixed(1)} ft`}</dd>
              </div>
              <div>
                <dt>Water</dt>
                <dd>{s.waterTempCMean === null ? '—' : `${Math.round(celsiusToFahrenheit(s.waterTempCMean))}°F`}</dd>
              </div>
              <div>
                <dt>Good days</dt>
                <dd>{Math.round(s.goodDayShare * 100)}%</dd>
              </div>
              <div>
                <dt>Main swell</dt>
                <dd>{s.dominantSwell ?? '—'}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
    </Card>
  );
}
