import { useState } from 'react';
import {
  celsiusToFahrenheit,
  degreesToCompass,
  describeWeather,
  formatClockRange,
  HOUR_MS,
  metersToFeet,
  mpsToMph,
  surfRating,
  uvLevel,
  type BeachAnalysis,
  type DayOutlook,
  type WindSummary,
} from '@seastate/shared';
import { clock, dayLabel, qualityColor, ratingColor, shortDate } from '../lib/format';
import { DirectionArrow, Icon, WeatherIcon } from './ui/Icon';
import { Section } from './ui/primitives';
import styles from './Outlook.module.css';

/**
 * The week: one row per day, built for comparing days at a glance. Temperature and surf are range
 * bars on a shared scale for the week, so a bigger day looks bigger. Open a day for the details.
 */
export function Outlook({ analysis }: { analysis: BeachAnalysis }) {
  const [open, setOpen] = useState<string | null>(null);
  const tz = analysis.beach.timezone;
  const days = analysis.days;
  const temps = days.flatMap((d) => [d.airLowC, d.airHighC]).filter((t): t is number => t !== null).map(celsiusToFahrenheit);
  const tempLo = Math.floor(Math.min(...temps));
  const tempHi = Math.ceil(Math.max(...temps));
  const surfTop = Math.max(4, ...days.map((d) => d.surf.maxFt));

  return (
    <Section id="week" title="This week" aside="Surf ranges cover daylight hours">
      <div className={styles.table} role="list">
        <div className={styles.header} aria-hidden="true">
          <span>Day</span>
          <span />
          <span>Air</span>
          <span>Surf</span>
          <span>Wind AM → PM</span>
          <span>Best surf</span>
          <span />
        </div>
        {days.map((day) => {
          const isOpen = open === day.key;
          const lo = day.airLowC === null ? null : celsiusToFahrenheit(day.airLowC);
          const hi = day.airHighC === null ? null : celsiusToFahrenheit(day.airHighC);
          const weather = describeWeather(day.weatherCode);
          const rating = surfRating(day.surf.peakScore);
          const best = day.windows.surf;
          return (
            <div key={day.key} className={styles.day} data-open={isOpen || undefined} role="listitem">
              <button type="button" className={styles.row} onClick={() => setOpen(isOpen ? null : day.key)} aria-expanded={isOpen}>
                <span className={styles.name}>
                  <strong>{dayLabel(day.startMs + 12 * HOUR_MS, tz, day.dayOffset)}</strong>
                  <span>{shortDate(day.startMs + 12 * HOUR_MS, tz)}</span>
                </span>
                <span className={styles.sky}>
                  <WeatherIcon sky={weather.sky} size={24} title={weather.label} />
                  {day.precipChanceMaxPct !== null && day.precipChanceMaxPct >= 20 && (
                    <span className={styles.rain}>{Math.round(day.precipChanceMaxPct / 10) * 10}%</span>
                  )}
                </span>
                <span className={styles.range}>
                  <span className={styles.lo}>{lo === null ? '—' : `${Math.round(lo)}°`}</span>
                  <span className={styles.track}>
                    {lo !== null && hi !== null && (
                      <span
                        className={styles.tempBar}
                        style={{
                          left: `${((lo - tempLo) / (tempHi - tempLo || 1)) * 100}%`,
                          width: `${Math.max(4, ((hi - lo) / (tempHi - tempLo || 1)) * 100)}%`,
                        }}
                      />
                    )}
                  </span>
                  <span className={styles.hi}>{hi === null ? '—' : `${Math.round(hi)}°`}</span>
                </span>
                <span className={styles.surf}>
                  <span className={styles.track}>
                    {day.surf.maxFt > 0 && (
                      <span
                        className={styles.surfBar}
                        style={{
                          left: `${(day.surf.minFt / surfTop) * 100}%`,
                          width: `${Math.max(6, ((day.surf.maxFt - day.surf.minFt) / surfTop) * 100)}%`,
                          background: ratingColor(rating.id),
                        }}
                      />
                    )}
                  </span>
                  <span className={styles.surfLabel}>
                    <strong>{day.surf.label}</strong>
                    <span>{rating.label}</span>
                  </span>
                </span>
                <span className={styles.wind}>
                  <WindChip wind={day.windAm} />
                  <span className={styles.arrowSep}>→</span>
                  <WindChip wind={day.windPm} />
                </span>
                <span className={styles.best}>{best && best.peakScore >= 45 ? formatClockRange(best.startMs, best.endMs, tz) : <span className={styles.none}>—</span>}</span>
                <Icon name="chevron" size={16} className={styles.chevron} />
              </button>
              {isOpen && <DayDetail analysis={analysis} day={day} />}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function WindChip({ wind }: { wind: WindSummary | null }) {
  if (!wind) return <span className={styles.windChip}>—</span>;
  return (
    <span className={styles.windChip} title={`${wind.quality.label}, ${Math.round(mpsToMph(wind.speedMps))} mph from ${degreesToCompass(wind.dirDeg)}`}>
      <DirectionArrow fromDeg={wind.dirDeg} size={13} color={qualityColor(wind.quality.score * 100)} />
      {Math.round(mpsToMph(wind.speedMps))}
    </span>
  );
}

function DayDetail({ analysis, day }: { analysis: BeachAnalysis; day: DayOutlook }) {
  const tz = analysis.beach.timezone;
  const daylight = day.points.filter((p) => p.ms >= day.sun.dawn && p.ms <= day.sun.dusk && p.ms % HOUR_MS === 0);
  return (
    <div className={styles.detail}>
      <div className={styles.ribbonWrap}>
        <p className={styles.detailLabel}>Surf through the day</p>
        <div className={styles.ribbon}>
          {daylight.map((p) => (
            <span key={p.ms} title={`${clock(p.ms, tz)}: ${p.scores.surf.surf.label}, ${surfRating(p.scores.surf.score).label.toLowerCase()}`}>
              <i style={{ background: ratingColor(p.scores.surf.rating), height: `${20 + (p.scores.surf.score / 100) * 80}%` }} />
            </span>
          ))}
        </div>
        <div className={styles.ribbonAxis}>
          <span>{clock(daylight[0]?.ms ?? day.sun.dawn, tz)}</span>
          <span>{clock(daylight.at(-1)?.ms ?? day.sun.dusk, tz)}</span>
        </div>
      </div>
      <dl className={styles.facts}>
        <div>
          <dt>Sun</dt>
          <dd>
            {clock(day.sun.sunrise, tz)} – {clock(day.sun.sunset, tz)}
          </dd>
        </div>
        <div>
          <dt>Tides</dt>
          <dd>
            {day.tides.length === 0
              ? '—'
              : day.tides.map((t) => `${t.type === 'high' ? 'H' : 'L'} ${metersToFeet(t.heightM).toFixed(1)} ${clock(Date.parse(t.time), tz)}`).join(' · ')}
          </dd>
        </div>
        <div>
          <dt>Water</dt>
          <dd>{day.waterTempC === null ? '—' : `${Math.round(celsiusToFahrenheit(day.waterTempC))}°F`}</dd>
        </div>
        <div>
          <dt>UV peak</dt>
          <dd>{day.uvMax === null ? '—' : `${Math.round(day.uvMax)} ${uvLevel(day.uvMax)}`}</dd>
        </div>
        <div>
          <dt>Best run</dt>
          <dd>{day.windows.run ? formatClockRange(day.windows.run.startMs, day.windows.run.endMs, tz) : '—'}</dd>
        </div>
        <div>
          <dt>Best beach</dt>
          <dd>{day.windows.beach ? formatClockRange(day.windows.beach.startMs, day.windows.beach.endMs, tz) : '—'}</dd>
        </div>
      </dl>
    </div>
  );
}
