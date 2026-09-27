import { useMemo } from 'react';
import { MINUTE_MS, sunTimes, type BeachAnalysis, type BeachInfo } from '@seastate/shared';
import { clock } from '../lib/format';
import { useSeen } from '../lib/hooks';
import { OceanScene } from '../scene/OceanScene';
import { sceneParamsFor } from '../scene/sceneParams';
import { EnterLink, Mark } from './ui';
import styles from './Closing.module.css';

/**
 * The last frame: the same water, today's sea and wind, lit as it will be just before sunset. Then the
 * way in, and where the numbers come from.
 */
export function Closing({
  beach,
  analysis,
  now,
}: {
  beach: BeachInfo | null;
  analysis: BeachAnalysis | null;
  now: number;
}) {
  const [ref, seen] = useSeen<HTMLElement>('0px 0px -20% 0px');
  const sunset = useMemo(
    () => (beach ? sunTimes(now, beach.lat, beach.lon, beach.timezone).sunset : null),
    [beach, now],
  );
  const params = useMemo(
    () => (beach && sunset ? sceneParamsFor(beach, analysis, sunset - 25 * MINUTE_MS) : null),
    [beach, analysis, sunset],
  );

  return (
    <>
      <section ref={ref} id="go" className={styles.closing} data-seen={seen || undefined}>
        <div className={styles.scene}>
          {params && <OceanScene params={params} className={styles.canvas} scrollRise={false} />}
        </div>
        <div className={styles.scrim} aria-hidden="true" />
        <div className={styles.content}>
          <h2 className={styles.title}>
            The water has changed
            <br />
            since you started reading.
          </h2>
          <div className={styles.actions}>
            <EnterLink>Open SeaState</EnterLink>
          </div>
          {beach && sunset && (
            <p className={styles.caption}>
              {beach.name} before sunset, {clock(sunset, beach.timezone)} tonight
            </p>
          )}
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footInner}>
          <p className={styles.brand}>
            <Mark size={18} />
            SeaState
          </p>
          <p>Seal Beach · Huntington Beach · Newport Beach</p>
          <p className={styles.credit}>
            Buoy and tide data from NOAA NDBC and CO-OPS. Weather and marine forecasts from{' '}
            <a href="https://open-meteo.com/">Open-Meteo</a>.
          </p>
        </div>
      </footer>
    </>
  );
}
