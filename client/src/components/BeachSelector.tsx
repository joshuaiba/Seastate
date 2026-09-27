import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { BeachInfo } from '@seastate/shared';
import styles from './BeachSelector.module.css';

export interface BeachOutlook {
  score: number;
  label: string;
}

/**
 * The beach switcher: the beaches as plain text, listed down the coast, with a thin rule under the
 * one being shown. Arrow keys move between beaches, as in any radio group. Each beach's surf outlook
 * is read out to screen readers.
 */
export function BeachSelector({
  beaches,
  selectedId,
  onSelect,
  outlook,
}: {
  beaches: BeachInfo[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  outlook: Record<string, BeachOutlook | undefined>;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [rule, setRule] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const el = selectedId ? refs.current[selectedId] : null;
      if (el) setRule({ left: el.offsetLeft, width: el.offsetWidth });
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
    <div className={styles.selector} role="radiogroup" aria-label="Beach">
      {rule && <span className={styles.rule} style={{ transform: `translateX(${rule.left}px)`, width: rule.width }} aria-hidden="true" />}
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
            <span className={styles.full}>{beach.name}</span>
            <span className={styles.short}>{beach.name.replace(/ Beach$/, '')}</span>
          </button>
        );
      })}
    </div>
  );
}
