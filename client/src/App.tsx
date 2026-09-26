import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useAnalyses, useSeastateData } from './data/useSeastate';
import { useNow } from './lib/hooks';
import { themeFor } from './theme/beaches';
import { ActivityCards } from './components/ActivityCards';
import { BeachSelector, type BeachOutlook } from './components/BeachSelector';
import { CompareBeaches } from './components/CompareBeaches';
import { ForecastTimeline } from './components/ForecastTimeline';
import { Hero } from './components/Hero';
import { NowPanel } from './components/NowPanel';
import { Outlook } from './components/Outlook';
import { SurfSection } from './components/SurfSection';
import { TideSection } from './components/TideSection';
import { TopBar } from './components/TopBar';
import styles from './App.module.css';

/** `?at=2026-09-26T18:30` pins the clock, for previewing other times of day against the same data. */
function pinnedTime(): number | null {
  const at = new URLSearchParams(window.location.search).get('at');
  const ms = at ? Date.parse(at) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function beachFromHash(): string | null {
  return decodeURIComponent(window.location.hash.replace(/^#/, '')) || null;
}

export function App() {
  const data = useSeastateData();
  const ticking = useNow(60_000);
  const [pinned] = useState(pinnedTime);
  const now = pinned ?? ticking;
  const { byBeach, comparison } = useAnalyses(data.beaches, data.sources, now);

  const [selectedId, setSelectedId] = useState<string | null>(beachFromHash);
  const beach = data.beaches.find((b) => b.id === selectedId) ?? data.beaches[0] ?? null;
  const analysis = beach ? (byBeach[beach.id] ?? null) : null;
  const theme = themeFor(beach?.id);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    history.replaceState(null, '', `${window.location.search}#${encodeURIComponent(id)}`);
  }, []);

  // ← and → move between beaches when nothing else has focus.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target !== document.body || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'ArrowRight') step(1);
      if (event.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    const onHash = () => {
      const id = beachFromHash();
      if (id) setSelectedId(id);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const step = useCallback(
    (direction: 1 | -1) => {
      if (!beach) return;
      const index = data.beaches.findIndex((b) => b.id === beach.id);
      const next = data.beaches[(index + direction + data.beaches.length) % data.beaches.length];
      if (next) select(next.id);
    },
    [beach, data.beaches, select],
  );

  const outlook = useMemo(() => {
    const result: Record<string, BeachOutlook | undefined> = {};
    for (const standing of comparison?.standings ?? []) {
      const a = byBeach[standing.beachId];
      if (a) result[standing.beachId] = { score: standing.outlook.surf, label: a.summaries.surf.label };
    }
    return result;
  }, [comparison, byBeach]);

  const loadedAt = beach ? (data.sources[beach.id]?.loadedAt ?? null) : null;
  const accentStyle = { '--accent': theme.accent, '--accent-soft': theme.accentSoft } as CSSProperties;

  const selector = (variant: 'bar' | 'dock') =>
    data.beaches.length > 0 && (
      <BeachSelector beaches={data.beaches} selectedId={beach?.id ?? null} onSelect={select} outlook={outlook} variant={variant} />
    );

  return (
    <div className={styles.app} style={accentStyle}>
      <TopBar
        selector={selector('bar')}
        mode={data.mode}
        loadedAt={loadedAt}
        refreshing={data.refreshing}
        onRefresh={data.refresh}
        now={ticking}
      />
      <Hero beach={beach} analysis={analysis} now={now} onSwipe={step} />
      <main className={styles.main}>
        {data.error ? (
          <p className={styles.error} role="alert">
            Couldn't reach the SeaState API: {data.error.message}
          </p>
        ) : (
          <NowPanel analysis={analysis} now={now} />
        )}
        {beach && data.sources[beach.id] && !analysis && (
          <p className={styles.error} role="alert">
            No forecast or buoy data came back for {beach.name}. Try refreshing in a minute.
          </p>
        )}
        {analysis && (
          // Keyed by beach so each section eases in when the beach changes.
          <div key={analysis.beach.id} className={styles.sections}>
            <ActivityCards analysis={analysis} comparison={comparison} />
            <ForecastTimeline analysis={analysis} now={now} />
            <div className={styles.twoUp}>
              <SurfSection analysis={analysis} now={now} />
              <TideSection analysis={analysis} now={now} />
            </div>
            <Outlook analysis={analysis} />
          </div>
        )}
        <CompareBeaches
          beaches={data.beaches}
          analyses={byBeach}
          comparison={comparison}
          selectedId={beach?.id ?? null}
          onSelect={select}
        />
      </main>
      <div className={styles.dock}>{selector('dock')}</div>
    </div>
  );
}
