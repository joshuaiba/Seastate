import { useEffect, useState } from 'react';
import { EnterLink, Mark } from './ui';
import styles from './LandingNav.module.css';

/** Wordmark, the page's three chapters, and the way in. Clear over the scene, solid once scrolled. */
export function LandingNav() {
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
          <Mark />
          SeaState
        </a>
        <nav className={styles.links} aria-label="On this page">
          <a href="#read">How it reads</a>
          <a href="#coast">The beaches</a>
          <a href="#built-for">Built for</a>
        </nav>
        <div className={styles.cta}>
          <EnterLink quiet>Open the app</EnterLink>
        </div>
      </div>
    </div>
  );
}
