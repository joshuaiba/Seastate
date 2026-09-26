import { useState } from 'react';
import { metersToFeet, nextExtremes, tideTrend, type BeachAnalysis } from '@seastate/shared';
import { clock, countdown, dayLabel } from '../lib/format';
import { Icon } from './ui/Icon';
import { AnimatedNumber, Section } from './ui/primitives';
import { TideChart } from './TideChart';
import styles from './TideSection.module.css';

/** The tide: where it is, which way it's going, the day's curve, and the next turns. */
export function TideSection({ analysis, now }: { analysis: BeachAnalysis; now: number }) {
  const [dayIndex, setDayIndex] = useState(0);
  const { beach, conditions } = analysis;
  const tz = beach.timezone;
  const days = analysis.days.slice(0, 3);
  const day = days[Math.min(dayIndex, days.length - 1)];
  const sample = analysis.now.sample;
  const rate = sample.tideRateMPerHour;
  const trend = rate === null ? null : tideTrend(rate);
  const upcoming = nextExtremes(conditions.tide, now);
  const offset = conditions.tide.observedOffsetM;

  return (
    <Section
      id="tide"
      eyebrow="Tide"
      title="The tide"
      aside={
        <div className={styles.tabs} role="tablist" aria-label="Tide day">
          {days.map((d, i) => (
            <button key={d.key} type="button" role="tab" aria-selected={i === dayIndex} className={styles.tab} onClick={() => setDayIndex(i)}>
              {dayLabel(d.startMs, tz, d.dayOffset)}
            </button>
          ))}
        </div>
      }
    >
      <div className={styles.card}>
        <div className={styles.now}>
          <div className={styles.current}>
            <p className={styles.label}>Now</p>
            <p className={styles.height}>
              <AnimatedNumber value={sample.tideM === null ? null : metersToFeet(sample.tideM)} digits={1} />
              <span className={styles.unit}>ft</span>
            </p>
            {trend && (
              <p className={styles.trend}>
                <Icon name={trend === 'falling' ? 'arrow-down' : 'arrow-up'} size={15} />
                {trend === 'slack' ? 'Turning' : trend === 'rising' ? 'Rising' : 'Falling'}
                {rate !== null && trend !== 'slack' && <span> {Math.abs(metersToFeet(rate)).toFixed(1)} ft/hr</span>}
              </p>
            )}
          </div>
          <ul className={styles.next}>
            {upcoming.map((e) => (
              <li key={e.ms}>
                <span className={styles.nextType}>Next {e.type}</span>
                <strong>{metersToFeet(e.heightM).toFixed(1)} ft</strong>
                <span className={styles.nextTime}>
                  {clock(e.ms, tz)} · {countdown(e.ms, now)}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.chart}>{day && <TideChart analysis={analysis} day={day} now={now} />}</div>
        <p className={styles.fine}>
          Heights above {conditions.tide.datum} (mean lower low water), predicted by NOAA for {beach.stations.coops.name}.
          {offset !== null && Math.abs(offset) >= 0.05 && (
            <> The water is running {Math.abs(metersToFeet(offset)).toFixed(1)} ft {offset > 0 ? 'above' : 'below'} the prediction.</>
          )}
        </p>
      </div>
    </Section>
  );
}
