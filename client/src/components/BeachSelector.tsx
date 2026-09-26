import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { BeachInfo } from '@seastate/shared';
import { qualityColor } from '../lib/format';
import styles from './BeachSelector.module.css';

export interface BeachOutlook {
  score: number;
  label: string;
}

/**
 * The beach switcher: a segmented control whose pill slides between beaches, listed down the coast.
 * Each beach carries a dot on the quality ramp for its surf outlook, so the selector itself hints at
 * which beach is best today. Arrow keys move between beaches, as in any radio group.
 */
export function BeachSelector({
  beaches,
  selectedId,
  onSelect,
  outlook,
  variant = 'bar',
}: {
  beaches: BeachInfo[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  outlook: Record<string, BeachOutlook | undefined>;
  variant?: 'bar' | 'dock';
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const el = selectedId ? refs.current[selectedId] : null;
      if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    // Web fonts change the widths once they load.
    document.fonts?.ready.then(measure).catch(() => {});
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [selectedId, beaches]);

  const move = (event: KeyboardEvent, index: number) => {
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = beaches[(index + delta + beaches.length) % beaches.length];
    if (next) {
      onSelect(next.id);
      refs.current[next.id]?.focus();
    }
  };

  return (
    <div className={`${styles.selector} ${styles[variant]}`} role="radiogroup" aria-label="Beach">
      {pill && <span className={styles.pill} style={{ transform: `translateX(${pill.left}px)`, width: pill.width }} aria-hidden="true" />}
      {beaches.map((beach, index) => {
        const selected = beach.id === selectedId;
        const o = outlook[beach.id];
        return (
          <button
            key={beach.id}
            ref={(el) => {
              refs.current[beach.id] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={styles.option}
            data-selected={selected || undefined}
            onClick={() => onSelect(beach.id)}
            onKeyDown={(event) => move(event, index)}
            aria-label={o ? `${beach.name}, surf ${o.label.toLowerCase()} today` : beach.name}
          >
            <span className={styles.dot} style={{ background: o ? qualityColor(o.score) : 'var(--ink-4)' }} />
            <span className={styles.full}>{beach.name}</span>
            <span className={styles.short}>{beach.name.replace(/ Beach$/, '')}</span>
          </button>
        );
      })}
    </div>
  );
}
