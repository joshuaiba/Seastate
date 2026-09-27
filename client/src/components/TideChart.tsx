import { useId, useMemo, useState, type PointerEvent } from 'react';
import { metersToFeet, tideHeightAt, type BeachAnalysis, type DayOutlook, MINUTE_MS, HOUR_MS } from '@seastate/shared';
import { clock, hourTick } from '../lib/format';
import { useElementWidth } from '../lib/hooks';
import styles from './TideChart.module.css';

interface TidePoint {
  ms: number;
  ft: number;
}

/** The predicted curve across [from, to], in feet. Falls back to high/low interpolation. */
function tideSeries(analysis: BeachAnalysis, from: number, to: number, stepMs = 10 * MINUTE_MS): TidePoint[] {
  const { tide } = analysis.conditions;
  const points: TidePoint[] = [];
  for (let ms = from; ms <= to; ms += stepMs) {
    const h = tideHeightAt(tide, ms);
    if (h !== null) points.push({ ms, ft: metersToFeet(h) });
  }
  return points;
}

function pathFor(points: TidePoint[], x: (ms: number) => number, y: (ft: number) => number): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.ms).toFixed(1)},${y(p.ft).toFixed(1)}`).join('');
}

/**
 * The full tide chart for one local day: the predicted curve as a body of water, highs and lows
 * labeled, night shaded, measured water level where the station has a gauge, and a marker for now.
 * Hover or drag to read any time.
 */
export function TideChart({ analysis, day, now }: { analysis: BeachAnalysis; day: DayOutlook; now: number }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const ids = useId();
  const [hover, setHover] = useState<number | null>(null);
  const tz = analysis.beach.timezone;
  const points = useMemo(() => tideSeries(analysis, day.startMs, day.endMs), [analysis, day]);
  const observed = useMemo(
    () =>
      analysis.conditions.tide.observed
        .filter((o) => o.ms >= day.startMs && o.ms < Math.min(day.endMs, now))
        .filter((_, i) => i % 2 === 0)
        .map((o) => ({ ms: o.ms, ft: metersToFeet(o.heightM) })),
    [analysis, day, now],
  );

  const height = 280;
  const pad = { top: 40, bottom: 26, left: 4, right: 4 };
  if (points.length < 2) {
    return (
      <div ref={ref} className={styles.empty}>
        No tide predictions for this day.
      </div>
    );
  }

  const heights = points.map((p) => p.ft);
  const lo = Math.min(...heights, ...observed.map((o) => o.ft));
  const hi = Math.max(...heights, ...observed.map((o) => o.ft));
  const span = hi - lo || 1;
  const plotW = Math.max(0, width - pad.left - pad.right);
  const x = (ms: number) => pad.left + ((ms - day.startMs) / (day.endMs - day.startMs)) * plotW;
  // Leave room under the lows for their labels.
  const y = (ft: number) => pad.top + (1 - (ft - (lo - span * 0.42)) / (span * 1.44)) * (height - pad.top - pad.bottom);
  const line = pathFor(points, x, y);
  const bottom = height - pad.bottom;
  const area = `${line}L${x(day.endMs).toFixed(1)},${bottom}L${x(day.startMs).toFixed(1)},${bottom}Z`;
  const isToday = now >= day.startMs && now < day.endMs;
  const nowFt = isToday ? tideHeightAt(analysis.conditions.tide, now) : null;
  const extremes = analysis.conditions.tide.extremes.filter((e) => e.ms >= day.startMs && e.ms < day.endMs);
  const ticks = Array.from({ length: 9 }, (_, i) => day.startMs + i * 3 * HOUR_MS).filter((t) => t <= day.endMs);

  const hoverFt = hover === null ? null : tideHeightAt(analysis.conditions.tide, hover);
  const onMove = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ms = day.startMs + ((event.clientX - rect.left - pad.left) / plotW) * (day.endMs - day.startMs);
    setHover(Math.min(day.endMs, Math.max(day.startMs, Math.round(ms / (10 * MINUTE_MS)) * 10 * MINUTE_MS)));
  };

  return (
    <div ref={ref} className={styles.chart}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Tide for ${day.key}: ${extremes.map((e) => `${e.type} ${metersToFeet(e.heightM).toFixed(1)} feet at ${clock(e.ms, tz)}`).join(', ')}`}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={`${ids}water`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--tide)" stopOpacity="0.32" />
              <stop offset="0.6" stopColor="var(--tide)" stopOpacity="0.1" />
              <stop offset="1" stopColor="var(--tide)" stopOpacity="0.02" />
            </linearGradient>
            <clipPath id={`${ids}clip`}>
              <path d={area} />
            </clipPath>
          </defs>

          {/* Night */}
          <rect x={x(day.startMs)} y={pad.top - 26} width={Math.max(0, x(day.sun.sunrise) - x(day.startMs))} height={bottom - pad.top + 26} fill="var(--night)" rx="2" />
          <rect x={x(day.sun.sunset)} y={pad.top - 26} width={Math.max(0, x(day.endMs) - x(day.sun.sunset))} height={bottom - pad.top + 26} fill="var(--night)" rx="2" />

          {/* Water body with a slow surface shimmer */}
          <path d={area} fill={`url(#${ids}water)`} />
          <g clipPath={`url(#${ids}clip)`} className={styles.shimmer}>
            {Array.from({ length: 7 }, (_, i) => (
              <path
                key={i}
                d={`M-80 ${pad.top + 30 + i * 26}${' q20 -3 40 0 q20 3 40 0'.repeat(Math.ceil(width / 80) + 2)}`}
                fill="none"
                stroke="var(--tide)"
                strokeOpacity={0.12 - i * 0.012}
                strokeWidth="1"
              />
            ))}
          </g>
          <path d={line} fill="none" stroke="var(--tide)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

          {observed.map((o) => (
            <circle key={o.ms} cx={x(o.ms)} cy={y(o.ft)} r="1.4" fill="var(--ink-2)" />
          ))}

          {/* Hours */}
          <line x1={pad.left} x2={pad.left + plotW} y1={bottom} y2={bottom} stroke="var(--hairline-strong)" />
          {ticks.map((t) => (
            <text key={t} x={x(t)} y={height - 9} className={styles.tick} textAnchor={t === day.startMs ? 'start' : t === day.endMs ? 'end' : 'middle'}>
              {hourTick(t, tz)}
            </text>
          ))}

          {/* Highs and lows */}
          {extremes.map((e) => {
            const ex = x(e.ms);
            const ey = y(metersToFeet(e.heightM));
            const above = e.type === 'high';
            const anchor = ex < 50 ? 'start' : ex > width - 50 ? 'end' : 'middle';
            return (
              <g key={e.ms}>
                <circle cx={ex} cy={ey} r="4.5" fill="var(--tide)" stroke="var(--surface)" strokeWidth="2" />
                <text x={ex} y={above ? ey - 24 : ey + 22} textAnchor={anchor} className={styles.extremeValue}>
                  {e.type === 'high' ? 'High' : 'Low'} {metersToFeet(e.heightM).toFixed(1)} ft
                </text>
                <text x={ex} y={above ? ey - 10 : ey + 36} textAnchor={anchor} className={styles.extremeTime}>
                  {clock(e.ms, tz)}
                </text>
              </g>
            );
          })}

          {/* Now */}
          {nowFt !== null && (
            <g className={styles.now}>
              <line x1={x(now)} x2={x(now)} y1={y(metersToFeet(nowFt)) + 8} y2={bottom} stroke="var(--ink-3)" strokeWidth="1" />
              <text x={x(now) + (x(now) > width - 60 ? -14 : 14)} y={y(metersToFeet(nowFt)) + 4} textAnchor={x(now) > width - 60 ? 'end' : 'start'} className={styles.nowLabel}>
                Now
              </text>
              <circle cx={x(now)} cy={y(metersToFeet(nowFt))} r="5.5" fill="var(--ink)" stroke="var(--surface)" strokeWidth="2.5" className={styles.bob} />
            </g>
          )}

          {hover !== null && hoverFt !== null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={pad.top - 20} y2={bottom} stroke="var(--ink-3)" strokeWidth="1" />
              <circle cx={x(hover)} cy={y(metersToFeet(hoverFt))} r="4" fill="var(--tide)" stroke="var(--surface)" strokeWidth="2" />
            </g>
          )}
        </svg>
      )}
      {hover !== null && hoverFt !== null && width > 0 && (
        <div
          className={styles.tooltip}
          style={{ left: Math.min(width - 90, Math.max(90, x(hover))) }}
          role="status"
        >
          <strong>{metersToFeet(hoverFt).toFixed(1)} ft</strong>
          <span>{clock(hover, tz)}</span>
        </div>
      )}
    </div>
  );
}
