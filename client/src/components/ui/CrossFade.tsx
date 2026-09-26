import { useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './CrossFade.module.css';

interface Item {
  id: string;
  node: ReactNode;
}

/**
 * Cross-fades content when `id` changes (the beach, usually): the old content drifts out while the new
 * content rises in, in the same grid cell so layout doesn't jump.
 */
export function CrossFade({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  const last = useRef<Item>({ id, node: children });
  const [exiting, setExiting] = useState<Item[]>([]);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const previous = last.current;
    if (previous.id === id) return;
    setExiting((list) => [...list.filter((item) => item.id !== id), previous]);
    timers.current.push(window.setTimeout(() => setExiting((list) => list.filter((item) => item !== previous)), 800));
  }, [id]);

  useEffect(() => {
    last.current = { id, node: children };
  });

  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);

  return (
    <div className={`${styles.stack} ${className ?? ''}`}>
      {exiting.map((item) => (
        <div key={`out-${item.id}`} className={styles.exit} aria-hidden="true">
          {item.node}
        </div>
      ))}
      <div key={id} className={exiting.length > 0 ? styles.enter : styles.static}>
        {children}
      </div>
    </div>
  );
}
