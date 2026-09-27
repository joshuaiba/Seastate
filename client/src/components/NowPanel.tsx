import type { ReactNode } from 'react';
import {
  celsiusToFahrenheit,
  describeWeather,
  degreesToCompass,
  nextExtremes,
  metersToFeet,
  surfRating,
  tideTrend,
  uvLevel,
  wetsuitFor,
  type BeachAnalysis,
  type Provenance,
} from '@seastate/shared';
import { ago, clock } from '../lib/format';
import { AnimatedNumber, RatingLabel, Skeleton } from './ui/primitives';
import { DirectionArrow, Icon } from './ui/Icon';
import styles from './NowPanel.module.css';

const SOURCE_NAME: Record<Provenance, string> = {
  buoy: 'Buoy',
  'tide-station': 'Tide station',
  model: 'Marine model',
  prediction: 'Prediction',
};

/**
 * Right now, at a glance: surf, wind, water, and tide as one instrument. Every column reads the
 * same way (label, value, what it means, one supporting fact), and the weather below sits on the
 * same four columns, so the eye can run down or across.
 */
export function NowPanel({ analysis, now }: { analysis: BeachAnalysis | null; now: number }) {
  if (!analysis) return <NowSkeleton />;
  const { sample, scores } = analysis.now;
  const { beach, conditions } = analysis;
  const tz = beach.timezone;
  const surf = scores.surf;
  const wind = surf.wind;
  const swell = surf.surf.dominant;
  const today = analysis.days[0];
  const waterF = sample.waterTempC === null ? null : celsiusToFahrenheit(sample.waterTempC);
  const waterSource = conditions.sources.waterTemp;
  const rate = sample.tideRateMPerHour;
  const trend = rate === null ? null : tideTrend(rate);
  const nextTide = nextExtremes(conditions.tide, now)[0];
  const weather = describeWeather(sample.weatherCode, sample.cloudCoverPct);
  // The next thing the sun does: rise (before dawn or after dark) or set.
  const sun = !today
    ? null
    : now < today.sun.sunrise
      ? { label: 'Sunrise', ms: today.sun.sunrise, other: `Sunset ${clock(today.sun.sunset, tz)}` }
      : now < today.sun.sunset
        ? { label: 'Sunset', ms: today.sun.sunset, other: `Sunrise ${clock(today.sun.sunrise, tz)}` }
        : { label: 'Sunrise', ms: analysis.days[1]?.sun.sunrise ?? null, other: 'Tomorrow' };

  return (
    <section className={styles.panel} aria-label="Current conditions">
      <div className={styles.grid}>
        <Reading label="Surf" aside={<RatingLabel>{surfRating(surf.score).label}</RatingLabel>}>
          <p className={styles.value}>
            {surf.surf.maxFt === 0 ? (
              'Flat'
            ) : (
              <>
                <AnimatedNumber value={surf.surf.minFt} />–<AnimatedNumber value={surf.surf.maxFt} />
                <span className={styles.unit}>ft</span>
              </>
            )}
          </p>
          <p className={styles.meaning}>{surf.surf.bodyRef}</p>
          <p className={styles.detail}>
            {swell ? `${degreesToCompass(swell.dirDeg)} ${swell.kind === 'wind' ? 'wind swell' : 'swell'} · ${Math.round(swell.periodS)} s` : 'No measurable swell'}
          </p>
        </Reading>

        <Reading label="Wind">
          <p className={styles.value}>
            <AnimatedNumber value={wind ? wind.speedMph : null} />
            <span className={styles.unit}>mph</span>
            {sample.windDirDeg !== null && (
              <span className={styles.direction}>
                <DirectionArrow fromDeg={sample.windDirDeg} size={15} />
                {degreesToCompass(sample.windDirDeg)}
              </span>
            )}
          </p>
          <p className={styles.meaning}>{wind ? wind.label : 'No wind data'}</p>
          <p className={styles.detail}>
            {sample.windGustMps !== null
              ? `Gusts ${Math.round(sample.windGustMps * 2.23694)} mph`
              : conditions.sources.wind?.source === 'tide-station'
                ? 'Measured at the tide station'
                : 'Forecast model'}
          </p>
        </Reading>

        <Reading label="Water">
          <p className={styles.value}>
            <AnimatedNumber value={waterF} />
            <span className={styles.unit}>°F</span>
          </p>
          <p className={styles.meaning}>{waterF === null ? 'No reading' : wetsuitFor(waterF)}</p>
          <p className={styles.detail}>
            {waterSource
              ? waterSource.time
                ? `${SOURCE_NAME[waterSource.source]} updated ${ago(Date.parse(waterSource.time), now)}`
                : SOURCE_NAME[waterSource.source]
              : '—'}
          </p>
        </Reading>

        <Reading label="Tide">
          <p className={styles.value}>
            <AnimatedNumber value={sample.tideM === null ? null : metersToFeet(sample.tideM)} digits={1} />
            <span className={styles.unit}>
              ft
              {trend && trend !== 'slack' && <Icon name={trend === 'falling' ? 'arrow-down' : 'arrow-up'} size={15} className={styles.trendIcon} />}
            </span>
          </p>
          <p className={styles.meaning}>{trend === 'slack' ? 'Turning' : trend === 'rising' ? 'Rising' : trend === 'falling' ? 'Falling' : '—'}</p>
          <p className={styles.detail}>
            {nextTide ? `${nextTide.type === 'high' ? 'High' : 'Low'} ${metersToFeet(nextTide.heightM).toFixed(1)} ft · ${clock(nextTide.ms, tz)}` : 'No tide predictions'}
          </p>
        </Reading>
      </div>

      <dl className={`${styles.grid} ${styles.weather}`}>
        <Detail label="Air">
          {sample.airTempC === null ? '—' : `${Math.round(celsiusToFahrenheit(sample.airTempC))}°`}
          <span className={styles.sub}>
            {sample.feelsLikeC !== null && `Feels ${Math.round(celsiusToFahrenheit(sample.feelsLikeC))}° · `}
            {weather.label}
          </span>
        </Detail>
        <Detail label="UV">
          {sample.uvIndex === null ? '—' : Math.round(sample.uvIndex)}
          <span className={styles.sub}>
            {sample.uvIndex !== null && capitalize(uvLevel(sample.uvIndex))}
            {today?.uvMax != null && today.uvMax > (sample.uvIndex ?? 0) + 1 && ` · peak ${Math.round(today.uvMax)}`}
          </span>
        </Detail>
        <Detail label="Rain">
          {sample.precipProbabilityPct === null ? '—' : `${Math.round(sample.precipProbabilityPct)}%`}
          {today?.precipChanceMaxPct != null && <span className={styles.sub}>{Math.round(today.precipChanceMaxPct)}% today</span>}
        </Detail>
        <Detail label={sun?.label ?? 'Sun'}>
          {sun?.ms ? clock(sun.ms, tz) : '—'}
          {sun && <span className={styles.sub}>{sun.other}</span>}
        </Detail>
      </dl>
    </section>
  );
}

function Reading({ label, aside, children }: { label: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <article className={styles.reading}>
      <header className={styles.head}>
        <h3 className={styles.label}>{label}</h3>
        {aside}
      </header>
      {children}
    </article>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.cell}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function NowSkeleton() {
  return (
    <section className={styles.panel} aria-busy="true" aria-label="Loading current conditions">
      <div className={styles.grid}>
        {['Surf', 'Wind', 'Water', 'Tide'].map((label) => (
          <Reading key={label} label={label}>
            <p className={styles.value}>
              <Skeleton width={96} height={40} />
            </p>
            <p className={styles.meaning}>
              <Skeleton width="60%" height={14} />
            </p>
          </Reading>
        ))}
      </div>
    </section>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
