import { useEffect, useState, type ReactNode } from 'react';
import type { DataMode } from '@seastate/shared';
import { ago } from '../lib/format';
import { Icon } from './ui/Icon';
import styles from './TopBar.module.css';

/** The floating bar: wordmark, the beach selector (desktop), data freshness, refresh. */
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
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 15c3 0 3-3.5 6-3.5s3 3.5 6 3.5 3-3.5 6-3.5" fill="none" stroke="var(--q5)" strokeWidth="2" strokeLinecap="round" />
            <circle cx="16.5" cy="7" r="2.6" fill="var(--sun)" />
          </svg>
          <span>
            Sea<em>State</em>
          </span>
        </a>
        <div className={styles.center}>{selector}</div>
        <div className={styles.status}>
          <span className={styles.freshness} data-mode={mode ?? undefined}>
            <span className={styles.pulse} aria-hidden="true" />
            {mode === 'fixture' ? 'Offline data' : 'Live'}
            {loadedAt && <span className={styles.ago}>· {ago(loadedAt, now)}</span>}
          </span>
          <button type="button" className={styles.refresh} onClick={onRefresh} disabled={refreshing} aria-label="Refresh conditions">
            <Icon name="refresh" size={16} className={refreshing ? styles.spinning : undefined} />
          </button>
        </div>
      </div>
    </div>
  );
}
