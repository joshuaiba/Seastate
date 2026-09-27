import { useEffect, useMemo, useRef, useState } from 'react';
import type { BeachAnalysis, BeachInfo } from '@seastate/shared';
import { fmtF } from '../lib/format';
import { useReducedMotion } from '../lib/hooks';
import { OceanScene } from '../scene/OceanScene';
import { sceneParamsFor } from '../scene/sceneParams';
import { EnterLink } from './ui';
import styles from './LandingHero.module.css';

/** How long the hero lingers on each beach before moving down the coast. */
const TOUR_MS = 12_000;

/**
 * The opening shot: the live scene, drifting from beach to beach on its own. The strip along the bottom
 * is both the chapter marker for the tour and a live readout of each beach. The tour holds while the
 * hero is off screen, and never runs under reduced motion.
 */
export function LandingHero({
  beaches,
  byBeach,
  now,
}: {
  beaches: BeachInfo[];
  byBeach: Record<string, BeachAnalysis>;
  now: number;
}) {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [onScreen, setOnScreen] = useState(true);

  const beach = beaches.length > 0 ? beaches[index % beaches.length]! : null;
  const analysis = beach ? (byBeach[beach.id] ?? null) : null;
  const params = useMemo(() => (beach ? sceneParamsFor(beach, analysis, now) : null), [beach, analysis, now]);
  const touring = !reduced && onScreen && beaches.length > 1;

  useEffect(() => {
    if (!touring) return;
    const timer = window.setTimeout(() => setIndex((i) => (i + 1) % beaches.length), TOUR_MS);
    return () => window.clearTimeout(timer);
  }, [touring, index, beaches.length]);

  // Hold the tour while the hero is scrolled away or the tab is hidden.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let inView = true;
    const sync = () => setOnScreen(inView && document.visibilityState === 'visible');
    const observer = new IntersectionObserver(
      ([entry]) => {
        inView = entry?.isIntersecting ?? true;
        sync();
      },
      { threshold: 0.35 },
    );
    observer.observe(el);
    document.addEventListener('visibilitychange', sync);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  // Scroll parallax through a CSS variable, as on the dashboard, so scrolling never re-renders React.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        el.style.setProperty('--hero-scroll', String(Math.min(window.scrollY, 1200))),
      );
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  return (
    <header ref={ref} className={styles.hero} id="top">
      <div className={styles.scene}>{params && <OceanScene params={params} className={styles.canvas} />}</div>
      <div className={styles.scrim} aria-hidden="true" />

      <div className={styles.content}>
        <h1 className={styles.title}>
          Read the water
          <br />
          before you go.
        </h1>
        <p className={styles.lede}>
          Surf, wind, tide, weather, and water, read together into one plain answer: what the beach is actually like
          right now.
        </p>
        <div className={styles.actions}>
          <EnterLink>Open SeaState</EnterLink>
          <EnterLink quiet href="#read">
            How it reads
          </EnterLink>
        </div>
      </div>

      {beaches.length > 0 && (
        <div className={styles.tour} role="group" aria-label="Beach shown in the scene">
          {beaches.map((b, i) => {
            const a = byBeach[b.id];
            const surf = a?.now.scores.surf;
            const active = i === index % beaches.length;
            return (
              <button
                key={b.id}
                type="button"
                className={styles.stop}
                aria-pressed={active}
                onClick={() => setIndex(i)}
              >
                <span className={styles.track} aria-hidden="true">
                  <span
                    // Restarts the fill whenever the tour moves on or resumes.
                    key={`${index}-${touring}`}
                    className={styles.fill}
                    data-state={active ? (touring ? 'running' : 'held') : undefined}
                    style={{ animationDuration: `${TOUR_MS}ms` }}
                  />
                </span>
                <span className={styles.stopName}>{b.name}</span>
                <span className={styles.stopRead}>
                  {surf ? (
                    <>
                      {surf.surf.label}
                      <span className={styles.stopExtra}>
                        {' '}
                        · {surf.wind?.label ?? 'Wind —'} · {fmtF(a.now.sample.waterTempC)} water
                      </span>
                    </>
                  ) : (
                    <span className={styles.stopPending} />
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </header>
  );
}
