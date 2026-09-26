import {
  celsiusToFahrenheit,
  describeWeather,
  degreesToCompass,
  metersToFeet,
  nextExtremes,
  surfRating,
  SURF_RATINGS,
  tideTrend,
  uvLevel,
  wetsuitFor,
  windPhrase,
  type BeachAnalysis,
} from '@seastate/shared';
import { ago, clock, qualityColor, ratingColor } from '../lib/format';
import { AnimatedNumber, QualityTag, Skeleton } from './ui/primitives';
import { DirectionArrow, Icon, WeatherIcon } from './ui/Icon';
import { TideSparkline } from './TideChart';
import styles from './NowPanel.module.css';

/**
 * Right now, at a glance. Four primary readings with a clear order (surf, wind, water, tide), then
 * the weather details in a quieter row. Designed to answer "what's it like?" in a few seconds.
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
  const rating = surfRating(surf.score);
  const waterF = sample.waterTempC === null ? null : celsiusToFahrenheit(sample.waterTempC);
  const rate = sample.tideRateMPerHour;
  const trend = rate === null ? null : tideTrend(rate);
  const upcomingTides = nextExtremes(conditions.tide, now);
  const nextTide = upcomingTides[0];
  const weather = describeWeather(sample.weatherCode, sample.cloudCoverPct);
  const night = sample.sunElevationDeg < -2;

  return (
    <section className={styles.panel} aria-label="Current conditions">
      <div className={styles.primary}>
        <article className={`${styles.tile} ${styles.surf}`}>
          <header className={styles.tileHead}>
            <span className={styles.label}>
              <Icon name="wave" size={16} /> Surf
            </span>
            <QualityTag label={rating.label} color={ratingColor(rating.id)} />
          </header>
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
          <p className={styles.sub}>{surf.surf.bodyRef}</p>
          <RatingScale score={surf.score} />
          <p className={styles.foot}>
            {swell
              ? `${degreesToCompass(swell.dirDeg)} ${metersToFeet(swell.heightM).toFixed(1)} ft @ ${Math.round(swell.periodS)} s ${swell.kind === 'wind' ? 'wind swell' : 'swell'}`
              : 'No measurable swell'}
          </p>
        </article>

        <article className={styles.tile}>
          <header className={styles.tileHead}>
            <span className={styles.label}>
              <Icon name="wind" size={16} /> Wind
            </span>
            {wind && <QualityTag label={wind.label} score={wind.score * 100} />}
          </header>
          <p className={styles.value}>
            <AnimatedNumber value={wind ? wind.speedMph : null} />
            <span className={styles.unit}>mph</span>
            {sample.windDirDeg !== null && (
              <span className={styles.direction}>
                <DirectionArrow fromDeg={sample.windDirDeg} size={20} color={wind ? qualityColor(wind.score * 100) : 'var(--ink-2)'} />
                {degreesToCompass(sample.windDirDeg)}
              </span>
            )}
          </p>
          <p className={styles.sub}>{wind ? capitalize(windPhrase(wind)) : 'No wind data'}</p>
          <p className={styles.foot}>
            {sample.windGustMps !== null ? `Gusts ${Math.round(sample.windGustMps * 2.23694)} mph · ` : ''}
            {analysis.conditions.sources.wind?.source === 'tide-station' ? 'Measured' : 'Forecast model'}
          </p>
        </article>

        <article className={styles.tile}>
          <header className={styles.tileHead}>
            <span className={styles.label}>
              <Icon name="drop" size={16} /> Water
            </span>
          </header>
          <p className={styles.value}>
            <AnimatedNumber value={waterF} />
            <span className={styles.unit}>°F</span>
          </p>
          <p className={styles.sub}>{waterF === null ? '—' : wetsuitFor(waterF)}</p>
          <p className={styles.foot}>
            {conditions.sources.waterTemp
              ? `${conditions.sources.waterTemp.source === 'buoy' ? `Buoy ${conditions.buoy?.station.id}` : conditions.sources.waterTemp.label}${
                  conditions.sources.waterTemp.time ? ` · ${ago(Date.parse(conditions.sources.waterTemp.time), now)}` : ''
                }`
              : 'No reading'}
          </p>
        </article>

        <article className={styles.tile}>
          <header className={styles.tileHead}>
            <span className={styles.label}>
              <Icon name="tide" size={16} /> Tide
            </span>
            {trend && (
              <span className={styles.trend}>
                <Icon name={trend === 'falling' ? 'arrow-down' : 'arrow-up'} size={14} />
                {trend === 'slack' ? 'Turning' : trend === 'rising' ? 'Rising' : 'Falling'}
              </span>
            )}
          </header>
          <p className={styles.value}>
            <AnimatedNumber value={sample.tideM === null ? null : metersToFeet(sample.tideM)} digits={1} />
            <span className={styles.unit}>ft</span>
          </p>
          {today && <TideSparkline analysis={analysis} day={today} now={now} />}
          <p className={styles.foot}>
            {nextTide
              ? `${nextTide.type === 'high' ? 'High' : 'Low'} ${metersToFeet(nextTide.heightM).toFixed(1)} ft at ${clock(nextTide.ms, tz)}`
              : 'No tide predictions'}
          </p>
        </article>
      </div>

      <dl className={styles.secondary}>
        <Detail icon={<WeatherIcon sky={weather.sky} night={night} size={18} />} label="Air">
          {sample.airTempC === null ? '—' : `${Math.round(celsiusToFahrenheit(sample.airTempC))}°`}
          {sample.feelsLikeC !== null && (
            <span className={styles.detailSub}>feels {Math.round(celsiusToFahrenheit(sample.feelsLikeC))}°</span>
          )}
        </Detail>
        <Detail icon={<Icon name="uv" size={17} />} label="UV">
          {sample.uvIndex === null ? '—' : Math.round(sample.uvIndex)}
          {sample.uvIndex !== null && <span className={styles.detailSub}>{uvLevel(sample.uvIndex)}</span>}
          {today?.uvMax != null && today.uvMax > (sample.uvIndex ?? 0) + 1 && (
            <span className={styles.detailSub}>· peak {Math.round(today.uvMax)}</span>
          )}
        </Detail>
        <Detail icon={<Icon name="cloud" size={17} />} label="Clouds">
          {sample.cloudCoverPct === null ? '—' : `${Math.round(sample.cloudCoverPct)}%`}
          <span className={styles.detailSub}>{weather.label.toLowerCase()}</span>
        </Detail>
        <Detail icon={<Icon name="rain" size={17} />} label="Rain">
          {sample.precipProbabilityPct === null ? '—' : `${Math.round(sample.precipProbabilityPct)}%`}
          {today?.precipChanceMaxPct != null && <span className={styles.detailSub}>today {Math.round(today.precipChanceMaxPct)}%</span>}
        </Detail>
        <Detail icon={<Icon name="sunrise" size={17} />} label="Sunrise">
          {today ? clock(today.sun.sunrise, tz) : '—'}
        </Detail>
        <Detail icon={<Icon name="sunset" size={17} />} label="Sunset">
          {today ? clock(today.sun.sunset, tz) : '—'}
        </Detail>
      </dl>
    </section>
  );
}

function Detail({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className={styles.detail}>
      <dt>
        <span className={styles.detailIcon}>{icon}</span>
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

/** The seven surf ratings as steps, with the current one lit. */
function RatingScale({ score }: { score: number }) {
  const current = surfRating(score).id;
  return (
    <div className={styles.scale} aria-hidden="true">
      {SURF_RATINGS.map((r, i) => (
        <span
          key={r.id}
          className={styles.scaleStep}
          data-on={r.id === current || undefined}
          style={{ background: `var(--q${i})`, opacity: SURF_RATINGS.findIndex((x) => x.id === current) >= i ? 1 : 0.28 }}
        />
      ))}
    </div>
  );
}

function NowSkeleton() {
  return (
    <section className={styles.panel} aria-busy="true" aria-label="Loading current conditions">
      <div className={styles.primary}>
        {['Surf', 'Wind', 'Water', 'Tide'].map((label) => (
          <article key={label} className={styles.tile}>
            <header className={styles.tileHead}>
              <span className={styles.label}>{label}</span>
            </header>
            <p className={styles.value}>
              <Skeleton width={110} height={44} />
            </p>
            <Skeleton width="70%" height={14} />
          </article>
        ))}
      </div>
    </section>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
