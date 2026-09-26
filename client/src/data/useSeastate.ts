import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  analyzeBeach,
  buildConditions,
  compareBeaches,
  type BeachAnalysis,
  type BeachInfo,
  type Comparison,
  type DataMode,
  type SourceId,
  type SourceResponse,
} from '@seastate/shared';
import { fetchBeaches, fetchSource } from '../api';

/*
 * Data fetching for the whole page. Every beach loads at once (the comparison needs all of them),
 * each one independently, so the first beach to arrive renders first. The server caches upstream
 * calls, so polling /api is cheap. A refresh keeps the previous data on screen until new data lands.
 */

export type SourceResult<K extends SourceId> = SourceResponse<K> | Error;

export interface BeachSources {
  ndbc: SourceResult<'ndbc'>;
  coops: SourceResult<'coops'>;
  openmeteo: SourceResult<'openmeteo'>;
  /** Epoch ms when this set finished loading. */
  loadedAt: number;
}

export interface SeastateData {
  mode: DataMode | null;
  beaches: BeachInfo[];
  sources: Record<string, BeachSources>;
  /** A load is in flight. */
  refreshing: boolean;
  /** The beach list itself couldn't be loaded. */
  error: Error | null;
  refresh: () => void;
}

const REFRESH_MS = 5 * 60_000;
/** Coming back to the tab after this long triggers a refresh. */
const STALE_MS = 2 * 60_000;

export function useSeastateData(): SeastateData {
  const [mode, setMode] = useState<DataMode | null>(null);
  const [beaches, setBeaches] = useState<BeachInfo[]>([]);
  const [sources, setSources] = useState<Record<string, BeachSources>>({});
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<Error | null>(null);
  const [cycle, setCycle] = useState(0);
  const lastLoad = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    lastLoad.current = Date.now();

    (async () => {
      let list: BeachInfo[];
      try {
        const response = await fetchBeaches(signal);
        if (signal.aborted) return;
        setMode(response.mode);
        setBeaches(response.beaches);
        setError(null);
        list = response.beaches;
      } catch (err) {
        if (!signal.aborted) setError(asError(err));
        return;
      }

      setPending((n) => n + list.length);
      await Promise.all(
        list.map(async (beach) => {
          // One failing source shouldn't hide the others, so errors are kept as values.
          const [ndbc, coops, openmeteo] = await Promise.all([
            fetchSource(beach.id, 'ndbc', signal).catch(asError),
            fetchSource(beach.id, 'coops', signal).catch(asError),
            fetchSource(beach.id, 'openmeteo', signal).catch(asError),
          ]);
          if (signal.aborted) return;
          setSources((prev) => ({ ...prev, [beach.id]: { ndbc, coops, openmeteo, loadedAt: Date.now() } }));
          setPending((n) => n - 1);
        }),
      );
    })();

    return () => {
      controller.abort();
      setPending(0);
    };
  }, [cycle]);

  const refresh = useCallback(() => setCycle((n) => n + 1), []);

  useEffect(() => {
    const timer = window.setInterval(refresh, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastLoad.current > STALE_MS) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  return { mode, beaches, sources, refreshing: pending > 0, error, refresh };
}

export interface Analyses {
  byBeach: Record<string, BeachAnalysis>;
  comparison: Comparison | null;
}

/** Runs the shared analysis for every beach with data. Recomputed when data arrives or the minute changes. */
export function useAnalyses(beaches: BeachInfo[], sources: Record<string, BeachSources>, now: number): Analyses {
  return useMemo(() => {
    const byBeach: Record<string, BeachAnalysis> = {};
    for (const beach of beaches) {
      const set = sources[beach.id];
      if (!set) continue;
      const data = <K extends SourceId>(result: SourceResult<K>) => (result instanceof Error ? null : result.data);
      // With no forecast there's nothing to analyze; the page shows what it can from the rest.
      if (set.openmeteo instanceof Error && set.ndbc instanceof Error) continue;
      byBeach[beach.id] = analyzeBeach(
        buildConditions({ beach, now, ndbc: data(set.ndbc), coops: data(set.coops), openmeteo: data(set.openmeteo) }),
      );
    }
    const list = Object.values(byBeach);
    return { byBeach, comparison: list.length > 1 ? compareBeaches(list) : null };
  }, [beaches, sources, now]);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
