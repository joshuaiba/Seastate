import { useMemo, useState } from 'react';
import type { BeachAnalysis } from '@seastate/shared';
import { useAnalyses, useSeastateData } from '../data/useSeastate';
import { useNow } from '../lib/hooks';
import { BuiltFor } from './BuiltFor';
import { Closing } from './Closing';
import { Coast } from './Coast';
import { LandingHero } from './LandingHero';
import { LandingNav } from './LandingNav';
import { Reading } from './Reading';
import styles from './Landing.module.css';

/**
 * The front door: what SeaState is, told with the same live data and scene as the dashboard. It opens
 * on the coast itself, explains the idea in one diagram, shows the three beaches as they are now, says
 * who it's for, and closes on the same water at sunset. Every reading on the page is live.
 */
/** `?at=2026-09-26T07:30-07:00` pins the clock, as on the dashboard, to preview another time of day. */
function pinnedTime(): number | null {
  const at = new URLSearchParams(window.location.search).get('at');
  const ms = at ? Date.parse(at) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

export function Landing() {
  const data = useSeastateData();
  const ticking = useNow(60_000);
  const [pinned] = useState(pinnedTime);
  const now = pinned ?? ticking;
  const { byBeach, comparison } = useAnalyses(data.beaches, data.sources, now);

  // The beach the "how it reads" diagram reads from: the best surf today, else the first with data.
  const featured = useMemo((): BeachAnalysis | null => {
    const best = comparison?.bestFor.surf;
    if (best && byBeach[best]) return byBeach[best];
    return data.beaches.map((b) => byBeach[b.id]).find((a) => a !== undefined) ?? null;
  }, [comparison, byBeach, data.beaches]);

  // The closing scene is Newport at sunset: the warm end of the coast.
  const closingBeach = data.beaches.find((b) => b.id === 'newport-beach') ?? data.beaches.at(-1) ?? null;

  return (
    <div className={styles.page}>
      <LandingNav />
      <LandingHero beaches={data.beaches} byBeach={byBeach} now={now} />
      <main>
        <Reading analysis={featured} />
        <Coast beaches={data.beaches} byBeach={byBeach} now={now} error={data.error} />
        <BuiltFor beaches={data.beaches} byBeach={byBeach} now={now} />
      </main>
      <Closing beach={closingBeach} analysis={closingBeach ? (byBeach[closingBeach.id] ?? null) : null} now={now} />
    </div>
  );
}
