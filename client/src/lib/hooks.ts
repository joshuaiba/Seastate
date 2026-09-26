import { useEffect, useRef, useState, type RefObject } from 'react';

/** Current time, updated every `intervalMs` and floored to it, so memoized work reruns on a schedule. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return Math.floor(now / intervalMs) * intervalMs;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export const useReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)');

/** Width of an element, kept current with a ResizeObserver. */
export function useElementWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** True once the element has come within `margin` of the viewport (and stays true). */
export function useSeen<T extends HTMLElement>(margin = '300px'): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setSeen(true);
      },
      { rootMargin: margin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [margin, seen]);
  return [ref, seen];
}

/**
 * Smoothly animates toward `target` (ease-out), for numbers that change when data or the beach does.
 * Returns the target immediately under reduced motion.
 */
export function useTweened(target: number | null, durationMs = 700): number | null {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(target);
  const from = useRef(target);
  const current = useRef(target);

  useEffect(() => {
    if (target === null || reduced || current.current === null) {
      current.current = target;
      setValue(target);
      return;
    }
    from.current = current.current;
    const start = performance.now();
    let frame = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / durationMs);
      const eased = 1 - (1 - p) ** 3;
      const next = from.current! + (target - from.current!) * eased;
      current.current = next;
      setValue(next);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs, reduced]);

  return value;
}
