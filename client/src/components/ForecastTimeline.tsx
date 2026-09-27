import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  celsiusToFahrenheit,
  degreesToCompass,
  describeWeather,
  formatClockRange,
  HOUR_MS,
  metersToFeet,
  MINUTE_MS,
  mpsToMph,
  surfRating,
  tideTrend,
  type BeachAnalysis,
  type ForecastPoint,
} from '@seastate/shared';
import { clock, dayLabel, hourTick, qualityColor, ratingColor } from '../lib/format';
import { useElementWidth, useMediaQuery } from '../lib/hooks';
import { WeatherIcon } from './ui/Icon';
import { Section } from './ui/primitives';
import styles from './ForecastTimeline.module.css';

const HOURS = 48;

/** Vertical layout of the lanes, px. */
const LANES = {
  header: { top: 0, height: 28 },
  sky: { top: 30, height: 34 },
  air: { top: 68, height: 54 },
  surf: { top: 136, height: 104 },
  wind: { top: 254, height: 50 },
  tide: { top: 318, height: 70 },
};
const HEIGHT = 400;

/**
 * The next 48 hours on one time axis, lane by lane: sky and air temperature, surf quality and size,
 * wind, and tide. Stacking them shows when conditions line up. The best surf windows are marked
 * across every lane. Hover (or tap, or use the arrow keys) to read everything at one time.
 */
export function ForecastTimeline({ analysis, now }: { analysis: BeachAnalysis; now: number }) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const narrow = useMediaQuery('(max-width: 760px)');
  const ids = useId();
  const [scrub, setScrub] = useState<number | null>(null);

  const start = Math.floor(now / HOUR_MS) * HOUR_MS;
  const end = start + HOURS * HOUR_MS;
  const points = useMemo(() => analysis.points.filter((p) => p.ms >= start && p.ms <= end), [analysis, start, end]);

  const labelW = narrow ? 0 : 72;
  // On phones the lane labels float over the start of the chart, so the data starts past them.
  const padX = narrow ? 62 : 12;
  const pxPerHour = narrow ? 38 : Math.max(18, (width - labelW - padX * 2) / HOURS);
  const plotW = pxPerHour * HOURS + padX * 2;
  const x = (ms: number) => padX + ((ms - start) / HOUR_MS) * pxPerHour;

  const model = useMemo(() => buildModel(analysis, points, start, end), [analysis, points, start, end]);
  if (points.length < 8) return null;

  const focusMs = scrub ?? now;
  const focus = nearest(points, focusMs);
  const setFromPointer = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ms = start + ((event.clientX - rect.left - padX) / pxPerHour) * HOUR_MS;
    setScrub(Math.min(end, Math.max(start, Math.round(ms / (15 * MINUTE_MS)) * 15 * MINUTE_MS)));
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') return setScrub(null);
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = Math.min(end, Math.max(start, (scrub ?? start) + step * HOUR_MS));
    setScrub(next);
    const el = scrollRef.current;
    if (el && narrow) el.scrollTo({ left: x(next) - el.clientWidth / 2, behavior: 'smooth' });
  };

  const { surfMax, air, tide, windows, nights, dayStarts } = model;
  const surfY = (ft: number) => LANES.surf.top + 14 + (1 - ft / surfMax) * (LANES.surf.height - 14);
  const airY = (f: number) => LANES.air.top + 14 + (1 - (f - air.lo) / (air.hi - air.lo || 1)) * (LANES.air.height - 22);
  const tideY = (ft: number) => LANES.tide.top + 8 + (1 - (ft - tide.lo) / (tide.hi - tide.lo || 1)) * (LANES.tide.height - 16);
  const line = (get: (p: ForecastPoint) => number | null, y: (v: number) => number) =>
    points
      .map((p) => {
        const v = get(p);
        return v === null ? null : `${x(p.ms).toFixed(1)},${y(v).toFixed(1)}`;
      })
      .filter(Boolean)
      .map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt}`)
      .join('');

  const surfLine = line((p) => p.scores.surf.surf.faceFt, surfY);
  const surfArea = `${surfLine}L${x(points.at(-1)!.ms)},${LANES.surf.top + LANES.surf.height}L${x(points[0]!.ms)},${LANES.surf.top + LANES.surf.height}Z`;
  const tideLine = line((p) => (p.sample.tideM === null ? null : metersToFeet(p.sample.tideM)), tideY);
  const tideArea = `${tideLine}L${x(points.at(-1)!.ms)},${LANES.tide.top + LANES.tide.height}L${x(points[0]!.ms)},${LANES.tide.top + LANES.tide.height}Z`;
  const airLine = line((p) => (p.sample.airTempC === null ? null : celsiusToFahrenheit(p.sample.airTempC)), airY);
  const hourly = points.filter((p) => p.ms % HOUR_MS === 0);
  const every = (hours: number) => hourly.filter((p) => Math.round((p.ms - start) / HOUR_MS) % hours === 0);
  const windStep = pxPerHour < 26 ? 3 : 2;

  return (
    <Section
      id="forecast"
      title="Next 48 hours"
      aside={narrow ? 'Swipe the timeline, tap to read' : 'Hover to read any hour, or use ← →'}
    >
      <div className={styles.panel}>
        <Readout analysis={analysis} point={focus} isNow={scrub === null} />
        <div ref={wrapRef} className={styles.frame}>
          {width > 0 && (
            <div className={narrow ? `${styles.labels} ${styles.overlay}` : styles.labels} aria-hidden="true">
              <span style={{ top: LANES.sky.top + 8 }}>Sky</span>
              <span style={{ top: LANES.air.top + 12 }}>Air °F</span>
              <span style={{ top: LANES.surf.top + 2 }}>Surf</span>
              <span className={styles.axis} style={{ top: surfY(surfMax) + 10 }}>
                {surfMax} ft
              </span>
              <span className={styles.axis} style={{ top: surfY(surfMax / 2) - 6 }}>
                {surfMax / 2}
              </span>
              <span style={{ top: LANES.wind.top + 6 }}>Wind</span>
              <span style={{ top: LANES.tide.top + 6 }}>Tide</span>
            </div>
          )}
          {width > 0 && (
          <div
            ref={scrollRef}
            className={styles.scroller}
            style={{ marginLeft: labelW }}
            tabIndex={0}
            role="group"
            aria-label="48-hour forecast. Use left and right arrow keys to step through hours."
            onKeyDown={onKey}
          >
            <svg
              width={plotW}
              height={HEIGHT}
              className={styles.svg}
              onPointerMove={(e) => e.pointerType === 'mouse' && setFromPointer(e)}
              onPointerDown={setFromPointer}
              onPointerLeave={(e) => e.pointerType === 'mouse' && setScrub(null)}
            >
              <defs>
                <linearGradient id={`${ids}surf`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor="var(--q5)" stopOpacity="0.2" />
                  <stop offset="1" stopColor="var(--q5)" stopOpacity="0.02" />
                </linearGradient>
                <linearGradient id={`${ids}tide`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor="var(--tide)" stopOpacity="0.16" />
                  <stop offset="1" stopColor="var(--tide)" stopOpacity="0.02" />
                </linearGradient>
              </defs>

              {nights.map(([a, b]) => (
                <rect key={a} x={x(a)} y={LANES.sky.top - 2} width={Math.max(0, x(b) - x(a))} height={HEIGHT - LANES.sky.top + 2} fill="var(--night)" />
              ))}

              {windows.map((w) => (
                <g key={w.startMs}>
                  <rect x={x(w.startMs)} y={LANES.sky.top - 2} width={x(w.endMs) - x(w.startMs)} height={HEIGHT - LANES.sky.top + 2} fill="var(--accent-soft)" rx="4" />
                  <line x1={x(w.startMs)} x2={x(w.endMs)} y1={LANES.surf.top + LANES.surf.height + 4} y2={LANES.surf.top + LANES.surf.height + 4} stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
                  <text x={x(w.startMs) + 4} y={LANES.surf.top + LANES.surf.height - 5} className={styles.windowLabel}>
                    Best {formatClockRange(w.startMs, w.endMs, analysis.beach.timezone)}
                  </text>
                </g>
              ))}

              {/* Day boundaries and hour ticks */}
              {dayStarts.map((d) => (
                <line key={d} x1={x(d)} x2={x(d)} y1={0} y2={HEIGHT} stroke="var(--hairline-strong)" />
              ))}
              <text x={padX} y={14} className={styles.day}>
                {dayLabel(start, analysis.beach.timezone, 0, 'long')}
              </text>
              {dayStarts.map((d, i) => (
                <text key={`l${d}`} x={x(d) + 6} y={14} className={styles.day}>
                  {dayLabel(d, analysis.beach.timezone, i + 1, 'long')}
                </text>
              ))}
              {every(3).map((p) => (
                <text key={p.ms} x={x(p.ms)} y={26} className={styles.hour} textAnchor={p.ms === start ? 'start' : 'middle'}>
                  {p.ms === start ? 'Now' : hourTick(p.ms, analysis.beach.timezone)}
                </text>
              ))}

              {/* Sky */}
              {every(3).map((p) => {
                const d = describeWeather(p.sample.weatherCode, p.sample.cloudCoverPct);
                return (
                  <g key={p.ms} transform={`translate(${x(p.ms) - 10},${LANES.sky.top + 6})`}>
                    <WeatherIcon sky={d.sky} night={p.sample.sunElevationDeg < -2} size={20} />
                  </g>
                );
              })}

              {/* Air temperature */}
              <path d={airLine} fill="none" stroke="var(--sun)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {air.labels.map((l) => (
                <text key={l.ms} x={x(l.ms)} y={airY(l.f) + (l.kind === 'max' ? -7 : 15)} className={styles.value} textAnchor="middle">
                  {Math.round(l.f)}°
                </text>
              ))}

              {/* Surf: quality ribbon, then height */}
              {model.ribbon.map((seg) => (
                <rect
                  key={seg.from}
                  x={x(seg.from) + 1}
                  y={LANES.surf.top}
                  width={Math.max(1, x(seg.to) - x(seg.from) - 2)}
                  height={6}
                  rx={3}
                  fill={ratingColor(seg.rating)}
                />
              ))}
              <line x1={0} x2={plotW} y1={surfY(surfMax / 2)} y2={surfY(surfMax / 2)} stroke="var(--hairline)" />
              <path d={surfArea} fill={`url(#${ids}surf)`} />
              <path d={surfLine} fill="none" stroke="var(--q5)" strokeWidth="2" strokeLinejoin="round" />
              {model.surfLabels.map((l) => (
                <text key={l.ms} x={x(l.ms)} y={surfY(l.ft) - 8} className={styles.value} textAnchor="middle">
                  {l.label}
                </text>
              ))}

              {/* Wind */}
              {every(windStep).map((p) => {
                const q = p.scores.surf.wind;
                if (!q || p.sample.windDirDeg === null) return null;
                const cx = x(p.ms);
                const cy = LANES.wind.top + 16;
                return (
                  <g key={p.ms}>
                    <g transform={`translate(${cx},${cy}) rotate(${p.sample.windDirDeg + 180})`}>
                      <path d="M0,-9 L5.5,7 L0,3.6 L-5.5,7 Z" fill={qualityColor(q.score * 100)} />
                    </g>
                    <text x={cx} y={LANES.wind.top + 42} className={styles.small} textAnchor="middle">
                      {Math.round(q.speedMph)}
                    </text>
                  </g>
                );
              })}

              {/* Tide */}
              <path d={tideArea} fill={`url(#${ids}tide)`} />
              <path d={tideLine} fill="none" stroke="var(--tide)" strokeWidth="2" strokeLinejoin="round" />
              {tide.extremes.map((e) => (
                <g key={e.ms}>
                  <circle cx={x(e.ms)} cy={tideY(e.ft)} r="4" fill="var(--tide)" stroke="var(--surface)" strokeWidth="2" />
                  <text x={x(e.ms)} y={e.type === 'high' ? tideY(e.ft) - 9 : tideY(e.ft) + 17} className={styles.small} textAnchor="middle">
                    {e.type === 'high' ? 'H' : 'L'} {e.ft.toFixed(1)}
                  </text>
                </g>
              ))}

              {/* Now and the scrubber */}
              <line x1={x(now)} x2={x(now)} y1={LANES.sky.top - 2} y2={HEIGHT} stroke="var(--ink-2)" strokeWidth="1" />
              {scrub !== null && (
                <g pointerEvents="none">
                  <line x1={x(scrub)} x2={x(scrub)} y1={0} y2={HEIGHT} stroke="var(--ink)" strokeWidth="1" />
                  <circle cx={x(focus.ms)} cy={surfY(focus.scores.surf.surf.faceFt)} r="4.5" fill="var(--q5)" stroke="var(--surface)" strokeWidth="2" />
                  {focus.sample.tideM !== null && (
                    <circle cx={x(focus.ms)} cy={tideY(metersToFeet(focus.sample.tideM))} r="4.5" fill="var(--tide)" stroke="var(--surface)" strokeWidth="2" />
                  )}
                  {focus.sample.airTempC !== null && (
                    <circle cx={x(focus.ms)} cy={airY(celsiusToFahrenheit(focus.sample.airTempC))} r="4" fill="var(--sun)" stroke="var(--surface)" strokeWidth="2" />
                  )}
                </g>
              )}
            </svg>
          </div>
          )}
        </div>
      </div>
    </Section>
  );
}

function Readout({ analysis, point, isNow }: { analysis: BeachAnalysis; point: ForecastPoint; isNow: boolean }) {
  const tz = analysis.beach.timezone;
  const { sample, scores } = point;
  const surf = scores.surf;
  const swell = surf.surf.dominant;
  const trend = sample.tideRateMPerHour === null ? null : tideTrend(sample.tideRateMPerHour);
  const dayOffset = analysis.days.findIndex((d) => point.ms >= d.startMs && point.ms < d.endMs);
  return (
    <div className={styles.readout} aria-live="polite">
      <div className={styles.readoutTime}>
        <span>{isNow ? 'Now' : dayLabel(point.ms, tz, Math.max(0, dayOffset))}</span>
        <strong>{clock(point.ms, tz)}</strong>
      </div>
      <Stat label="Surf" value={surf.surf.label} sub={surfRating(surf.score).label} />
      <Stat
        label="Swell"
        value={swell ? `${metersToFeet(swell.heightM).toFixed(1)} ft · ${Math.round(swell.periodS)} s` : '—'}
        sub={swell ? degreesToCompass(swell.dirDeg) : ''}
      />
      <Stat
        label="Wind"
        value={sample.windSpeedMps === null ? '—' : `${Math.round(mpsToMph(sample.windSpeedMps))} mph ${sample.windDirDeg === null ? '' : degreesToCompass(sample.windDirDeg)}`}
        sub={surf.wind?.label ?? ''}
      />
      <Stat
        label="Tide"
        value={sample.tideM === null ? '—' : `${metersToFeet(sample.tideM).toFixed(1)} ft`}
        sub={trend === 'rising' ? 'Rising' : trend === 'falling' ? 'Falling' : trend ? 'Turning' : ''}
      />
      <Stat
        label="Air"
        value={sample.airTempC === null ? '—' : `${Math.round(celsiusToFahrenheit(sample.airTempC))}°F`}
        sub={describeWeather(sample.weatherCode, sample.cloudCoverPct).label}
      />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statSub}>{sub}</span>
    </div>
  );
}

function nearest(points: ForecastPoint[], ms: number): ForecastPoint {
  return points.reduce((best, p) => (Math.abs(p.ms - ms) < Math.abs(best.ms - ms) ? p : best), points[0]!);
}

function buildModel(analysis: BeachAnalysis, points: ForecastPoint[], start: number, end: number) {
  const faces = points.map((p) => p.scores.surf.surf.faceFt);
  const surfMax = Math.max(4, Math.ceil((Math.max(0, ...faces) * 1.25) / 2) * 2);

  const temps = points.flatMap((p) => (p.sample.airTempC === null ? [] : [celsiusToFahrenheit(p.sample.airTempC)]));
  const airLabels: { ms: number; f: number; kind: 'max' | 'min' }[] = [];
  for (const day of analysis.days) {
    const inDay = points.filter((p) => p.ms >= day.startMs && p.ms < day.endMs && p.sample.airTempC !== null);
    if (inDay.length < 12) continue;
    const hot = inDay.reduce((a, b) => (b.sample.airTempC! > a.sample.airTempC! ? b : a));
    const cold = inDay.reduce((a, b) => (b.sample.airTempC! < a.sample.airTempC! ? b : a));
    airLabels.push({ ms: hot.ms, f: celsiusToFahrenheit(hot.sample.airTempC!), kind: 'max' });
    airLabels.push({ ms: cold.ms, f: celsiusToFahrenheit(cold.sample.airTempC!), kind: 'min' });
  }

  const tides = points.flatMap((p) => (p.sample.tideM === null ? [] : [metersToFeet(p.sample.tideM)]));
  const extremes = analysis.conditions.tide.extremes
    .filter((e) => e.ms >= start && e.ms <= end)
    .map((e) => ({ ms: e.ms, ft: metersToFeet(e.heightM), type: e.type }));

  // Merge the 15-minute surf ratings into runs of the same rating.
  const ribbon: { from: number; to: number; rating: ReturnType<typeof surfRating>['id'] }[] = [];
  for (const p of points) {
    const rating = p.scores.surf.rating;
    const last = ribbon.at(-1);
    if (last && last.rating === rating) last.to = p.ms + 15 * MINUTE_MS;
    else ribbon.push({ from: p.ms, to: p.ms + 15 * MINUTE_MS, rating });
  }

  // Label the surf at each day's daylight peak.
  const surfLabels = analysis.days.flatMap((day) => {
    const inDay = points.filter((p) => p.ms >= day.sun.sunrise && p.ms <= day.sun.sunset);
    if (inDay.length < 8) return [];
    const top = inDay.reduce((a, b) => (b.scores.surf.surf.faceFt > a.scores.surf.surf.faceFt ? b : a));
    return [{ ms: top.ms, ft: top.scores.surf.surf.faceFt, label: top.scores.surf.surf.label }];
  });

  const windows = analysis.days
    .map((d) => d.windows.surf)
    .filter((w): w is NonNullable<typeof w> => w !== null && w.endMs > start && w.startMs < end && w.peakScore >= 45)
    .map((w) => ({ ...w, startMs: Math.max(w.startMs, start), endMs: Math.min(w.endMs, end) }))
    .filter((w) => w.endMs - w.startMs >= HOUR_MS);

  const nights: [number, number][] = [];
  analysis.days.forEach((d, i) => {
    if (i === 0) nights.push([Math.max(start, d.startMs), d.sun.sunrise]);
    const next = analysis.days[i + 1];
    nights.push([d.sun.sunset, next ? next.sun.sunrise : d.endMs]);
  });

  return {
    surfMax,
    air: { lo: Math.min(...temps) - 2, hi: Math.max(...temps) + 2, labels: airLabels },
    tide: { lo: Math.min(...tides), hi: Math.max(...tides), extremes },
    ribbon,
    surfLabels,
    windows,
    nights: nights
      .map(([a, b]) => [Math.max(a, start), Math.min(b, end)] as [number, number])
      .filter(([a, b]) => b > a),
    dayStarts: analysis.days.map((d) => d.startMs).filter((ms) => ms > start && ms < end),
  };
}
