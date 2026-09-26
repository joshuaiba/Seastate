import type { BeachAnalysis, BeachInfo, DataMode } from '@seastate/shared';
import styles from './Footer.module.css';

/** Where every number on the page comes from, for the selected beach. */
export function Footer({ beach, analysis, mode }: { beach: BeachInfo | null; analysis: BeachAnalysis | null; mode: DataMode | null }) {
  const sources = analysis?.conditions.sources;
  return (
    <footer className={styles.footer}>
      <div className={styles.brand}>
        <p className={styles.name}>
          Sea<em>State</em>
        </p>
        <p className={styles.tagline}>A personal read on Seal Beach, Huntington, and Newport, and whether it's worth going.</p>
      </div>
      {beach && (
        <dl className={styles.sources}>
          <div>
            <dt>Waves & water</dt>
            <dd>
              NOAA NDBC buoy {beach.stations.ndbc.id} · {beach.stations.ndbc.name}
            </dd>
          </div>
          <div>
            <dt>Tides</dt>
            <dd>
              NOAA CO-OPS {beach.stations.coops.id} · {beach.stations.coops.name}
            </dd>
          </div>
          <div>
            <dt>Forecast</dt>
            <dd>Open-Meteo weather and marine models</dd>
          </div>
          {sources?.swell && (
            <div>
              <dt>Surf now</dt>
              <dd>{sources.swell.label}</dd>
            </div>
          )}
        </dl>
      )}
      <p className={styles.fine}>
        Surf heights are estimates from offshore swell and each beach's exposure, not observations. Scores and windows are
        computed in the browser from the same data you see here.
        {mode === 'fixture' && ' Offline mode: showing captured data with shifted timestamps.'}
      </p>
    </footer>
  );
}
