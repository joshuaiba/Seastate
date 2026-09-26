import type { ReactNode } from 'react';
import { useTweened } from '../../lib/hooks';
import { qualityColor } from '../../lib/format';
import styles from './primitives.module.css';

/** A number that eases to its new value when data or the beach changes. */
export function AnimatedNumber({ value, digits = 0, className }: { value: number | null; digits?: number; className?: string }) {
  const shown = useTweened(value);
  return <span className={className}>{shown === null ? '—' : shown.toFixed(digits)}</span>;
}

export function Section({
  id,
  eyebrow,
  title,
  aside,
  children,
  className,
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`${styles.section} ${className ?? ''}`} aria-labelledby={id ? `${id}-title` : undefined}>
      <header className={styles.sectionHeader}>
        <div>
          {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
          <h2 id={id ? `${id}-title` : undefined} className={styles.sectionTitle}>
            {title}
          </h2>
        </div>
        {aside && <div className={styles.sectionAside}>{aside}</div>}
      </header>
      {children}
    </section>
  );
}

/** Thin meter on the quality ramp; the unfilled track is a dim step of the same hue. */
export function QualityMeter({ score, label }: { score: number; label: string }) {
  return (
    <div className={styles.meter} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(score)} aria-label={label}>
      <div className={styles.meterFill} style={{ width: `${Math.max(3, score)}%`, background: qualityColor(score) }} />
    </div>
  );
}

/** A rating label keyed by a dot on the quality ramp. Color is never the only signal. */
export function QualityTag({ score, label, color }: { score?: number; label: string; color?: string }) {
  return (
    <span className={styles.tag}>
      <span className={styles.tagDot} style={{ background: color ?? qualityColor(score ?? 0) }} />
      {label}
    </span>
  );
}

export function Skeleton({ width = '100%', height = 16 }: { width?: number | string; height?: number | string }) {
  return <span className={styles.skeleton} style={{ width, height }} aria-hidden="true" />;
}

export function Glass({ children, className, as: Tag = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'article' | 'section' }) {
  return <Tag className={`${styles.glass} ${className ?? ''}`}>{children}</Tag>;
}
