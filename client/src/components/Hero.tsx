import { useEffect, useMemo, useRef } from 'react';
import type { BeachAnalysis, BeachInfo } from '@seastate/shared';
import { clock } from '../lib/format';
import { OceanScene } from '../scene/OceanScene';
import { sceneCaption, sceneParamsFor } from '../scene/sceneParams';
import { themeFor } from '../theme/beaches';
import { CrossFade } from './ui/CrossFade';
import { Icon } from './ui/Icon';
import styles from './Hero.module.css';

/**
 * The top of the page: the live scene, the beach's name, and the one-line verdict. Swiping sideways
 * on a phone moves between beaches.
 */
export function Hero({
  beach,
  analysis,
  now,
  onSwipe,
}: {
  beach: BeachInfo | null;
  analysis: BeachAnalysis | null;
  now: number;
  onSwipe: (direction: 1 | -1) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const params = useMemo(() => (beach ? sceneParamsFor(beach, analysis, now) : null), [beach, analysis, now]);
  const theme = themeFor(beach?.id);
  const verdict = analysis?.verdict;
  const caption = sceneCaption(analysis);

  // Scroll parallax through a CSS variable, so scrolling never re-renders React.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => el.style.setProperty('--hero-scroll', String(Math.min(window.scrollY, 1200))));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  // Horizontal swipe between beaches on touch screens.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let start: { x: number; y: number } | null = null;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      start = t ? { x: t.clientX, y: t.clientY } : null;
    };
    const onEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      if (!start || !t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (Math.abs(dx) > 64 && Math.abs(dy) < 48) onSwipe(dx < 0 ? 1 : -1);
      start = null;
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchend', onEnd);
    };
  }, [onSwipe]);

  return (
    <header ref={ref} className={styles.hero} id="top">
      <div className={styles.scene}>{params && <OceanScene params={params} className={styles.canvas} />}</div>
      <div className={styles.scrim} aria-hidden="true" />

      <div className={styles.content}>
        {beach && (
          <CrossFade id={beach.id}>
            <p className={styles.meta}>
              <Icon name="pin" size={14} />
              {beach.region}
              <span className={styles.metaDivider} aria-hidden="true" />
              <span className="tabular">{clock(now, beach.timezone)}</span>
            </p>
            <h1 className={styles.name}>{beach.name}</h1>
            <p className={styles.character}>{theme.character}</p>
          </CrossFade>
        )}

        <div className={styles.verdictSlot} aria-live="polite">
          {verdict && beach ? (
            <CrossFade id={`${beach.id}|${verdict.eyebrow}|${verdict.headline}`}>
              <div className={styles.verdict} data-tone={verdict.tone}>
                <span className={styles.verdictEyebrow}>
                  <span className={styles.toneDot} aria-hidden="true" />
                  {verdict.eyebrow}
                </span>
                <span className={styles.verdictHeadline}>{verdict.headline}</span>
              </div>
            </CrossFade>
          ) : (
            <div className={styles.verdictPlaceholder} aria-hidden="true" />
          )}
        </div>
      </div>

      {caption && (
        <p className={styles.caption}>
          <span className={styles.captionLabel}>Scene</span> {caption}
        </p>
      )}
    </header>
  );
}
