import { useEffect, useState } from 'react';
import type { HistorySummary } from '@seastate/shared';
import { fetchHistory } from '../api';

// History changes slowly and costs the server a little to summarize, so each beach's is loaded once
// per page view, and only when the Insights section is about to be seen.
const cache = new Map<string, Promise<HistorySummary>>();

export function useHistory(beachId: string | null, enabled: boolean): { history: HistorySummary | null; error: Error | null } {
  const [state, setState] = useState<{ id: string; history: HistorySummary | null; error: Error | null } | null>(null);

  useEffect(() => {
    if (!beachId || !enabled) return;
    let current = true;
    let request = cache.get(beachId);
    if (!request) {
      request = fetchHistory(beachId);
      cache.set(beachId, request);
      request.catch(() => cache.delete(beachId));
    }
    request.then(
      (history) => current && setState({ id: beachId, history, error: null }),
      (error: unknown) =>
        current && setState({ id: beachId, history: null, error: error instanceof Error ? error : new Error(String(error)) }),
    );
    return () => {
      current = false;
    };
  }, [beachId, enabled]);

  // Keep showing the previous beach's history until the new one arrives, rather than flashing empty.
  return { history: state?.history ?? null, error: state?.id === beachId ? state.error : null };
}
