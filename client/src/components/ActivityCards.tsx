import {
  celsiusToFahrenheit,
  describeWeather,
  formatClockRange,
  mpsToMph,
  uvLevel,
  windPhrase,
  type Activity,
  type BeachAnalysis,
  type Comparison,
  type WindowInsight,
} from '@seastate/shared';
import { dayLabel } from '../lib/format';
import { Icon } from './ui/Icon';
import { QualityMeter, RatingLabel, Section } from './ui/primitives';
import styles from './ActivityCards.module.css';

const META: Record<Activity, { title: string; window: string }> = {
  surf: { title: 'Surf', window: 'Best surf window' },
  run: { title: 'Run', window: 'Best time to run' },
  beach: { title: 'Beach', window: 'Best beach hours' },
};

const FACTOR_LABELS: Record<string, string> = {
  size: 'Wave size',
  wind: 'Wind',
  period: 'Swell period',
  tide: 'Tide',
  heat: 'Heat',
  cold: 'Warmth',
  uv: 'UV',
  rain: 'Rain',
  dark: 'Daylight',
  clouds: 'Sunshine',
};

/**
 * "Should I go?": each activity scored and summarized in a sentence, with the next good window and
 * what's driving the score. It's the part of the page that turns readings into a decision.
 */
export function ActivityCards({ analysis, comparison }: { analysis: BeachAnalysis; comparison: Comparison | null }) {
  const daylight = analysis.now.sample.sunElevationDeg > -6 && (!analysis.days[0] || analysis.now.ms < analysis.days[0].sun.sunset);
  return (
    <Section id="go" title="When to go" aside={daylight ? 'Scored from right now' : 'Looking ahead to first light'}>
      <div className={styles.grid}>
        {(['surf', 'run', 'beach'] as const).map((activity) => (
          <ActivityCard
            key={activity}
            activity={activity}
            analysis={analysis}
            daylight={daylight}
            best={comparison?.bestFor[activity] === analysis.beach.id}
          />
        ))}
      </div>
    </Section>
  );
}

function ActivityCard({
  activity,
  analysis,
  daylight,
  best,
}: {
  activity: Activity;
  analysis: BeachAnalysis;
  daylight: boolean;
  best: boolean;
}) {
  const meta = META[activity];
  const summary = analysis.summaries[activity];
  const upcoming = analysis.upcoming[activity];
  const scoreNow = analysis.now.scores[activity].score;
  const score = daylight ? scoreNow : (upcoming?.window.peakScore ?? scoreNow);
  const factors = Object.entries(analysis.now.scores[activity].factors) as [string, number][];

  return (
    <article className={styles.card}>
      <header className={styles.head}>
        <h3 className={styles.title}>{meta.title}</h3>
        <RatingLabel>{summary.label}</RatingLabel>
      </header>
      <QualityMeter score={score} label={`${meta.title} score`} />
      <p className={styles.summary}>{summary.text}</p>

      <div className={styles.window}>
        <p className={styles.windowLabel}>
          {meta.window}
          {upcoming && <> · {upcoming.active ? 'Now' : dayLabel(upcoming.window.startMs, analysis.beach.timezone, upcoming.dayOffset)}</>}
        </p>
        {upcoming ? (
          <>
            <p className={styles.windowTime}>{formatClockRange(upcoming.window.startMs, upcoming.window.endMs, analysis.beach.timezone)}</p>
            <ul className={styles.windowFacts}>
              {windowFacts(activity, upcoming).map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
          </>
        ) : (
          <p className={styles.noWindow}>Nothing stands out in the next two days.</p>
        )}
      </div>

      {summary.note && activity !== 'surf' && <p className={styles.note}>{summary.note}</p>}
      {best && (
        <p className={styles.best}>
          Best of your beaches for {activity === 'surf' ? 'surf' : activity === 'run' ? 'a run' : 'the beach'} today
        </p>
      )}

      <details className={styles.why}>
        <summary>
          Why this score
          <Icon name="chevron" size={14} className={styles.chevron} />
        </summary>
        <ul className={styles.factors}>
          {factors.map(([factor, value]) => (
            <li key={factor}>
              <span>{FACTOR_LABELS[factor] ?? factor}</span>
              <QualityMeter score={value * 100} label={FACTOR_LABELS[factor] ?? factor} />
              <span className={styles.factorValue}>{Math.round(value * 100)}</span>
            </li>
          ))}
        </ul>
        <p className={styles.method}>Each factor is 0–100; the score multiplies them, so one bad factor sinks it.</p>
      </details>
    </article>
  );
}

function windowFacts(activity: Activity, w: WindowInsight): string[] {
  const { sample, scores } = w.peak;
  if (activity === 'surf') {
    const facts = [scores.surf.surf.label === 'Flat' ? 'Flat' : `${scores.surf.surf.label} surf`];
    if (scores.surf.wind) facts.push(capitalize(windPhrase(scores.surf.wind)));
    if (w.tideTrend) facts.push(w.tideTrend === 'rising' ? 'Incoming tide' : w.tideTrend === 'falling' ? 'Outgoing tide' : 'Tide turning');
    return facts;
  }
  const facts: string[] = [];
  const feels = sample.feelsLikeC ?? sample.airTempC;
  if (feels !== null) facts.push(`Feels ${Math.round(celsiusToFahrenheit(feels))}°F`);
  if (activity === 'beach') facts.push(describeWeather(sample.weatherCode, sample.cloudCoverPct).label);
  if (sample.windSpeedMps !== null) facts.push(`${Math.round(mpsToMph(sample.windSpeedMps))} mph wind`);
  if (sample.uvIndex !== null && (activity === 'beach' || sample.uvIndex >= 3)) facts.push(`UV ${Math.round(sample.uvIndex)} ${uvLevel(sample.uvIndex)}`);
  return facts;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
