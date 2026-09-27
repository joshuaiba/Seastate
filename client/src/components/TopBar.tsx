import { useEffect, useState, type ReactNode } from 'react';
import type { DataMode } from '@seastate/shared';
import { ago } from '../lib/format';
import { Icon } from './ui/Icon';
import styles from './TopBar.module.css';

/** The bar across the top: wordmark, the beach navigation, when the data was loaded, refresh. */
export function TopBar({
  selector,
  mode,
  loadedAt,
  refreshing,
  onRefresh,
  now,
}: {
  selector: ReactNode;
  mode: DataMode | null;
  loadedAt: number | null;
  refreshing: boolean;
  onRefresh: () => void;
  now: number;
}) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className={styles.bar} data-scrolled={scrolled || undefined}>
      <div className={styles.inner}>
        <a className={styles.brand} href="#top" aria-label="SeaState, back to top">
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 15c3 0 3-3.5 6-3.5s3 3.5 6 3.5 3-3.5 6-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="16.5" cy="7" r="2.6" fill="var(--sun)" />
          </svg>
          SeaState
        </a>
        <nav className={styles.nav} aria-label="Beaches">
          {selector}
        </nav>
        <div className={styles.status}>
          <span className={styles.freshness} aria-live="polite">
            {mode === 'fixture' && <span className={styles.mode}>Offline data</span>}
            {loadedAt ? `Updated ${ago(loadedAt, now)}` : 'Loading'}
          </span>
          <button type="button" className={styles.refresh} onClick={onRefresh} disabled={refreshing} aria-label="Refresh conditions">
            <Icon name="refresh" size={16} className={refreshing ? styles.spinning : undefined} />
          </button>
        </div>
      </div>
    </div>
  );
}
