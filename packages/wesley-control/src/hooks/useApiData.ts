import { useCallback, useEffect, useRef, useState } from 'react';

import {
  FetchState,
  initialFetchState,
  reduceFetchState,
} from '../lib/freshness';

const AUTO_REFRESH_MS = 60000;

/**
 * Polling data hook built on the freshness state machine: auto-refresh every
 * 60 s, pull-to-refresh via `refresh()`, and stale-not-blank semantics when
 * the backend stops answering.
 */
export function useApiData<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
): FetchState<T> & { refresh: () => Promise<void> } {
  const [state, setState] = useState<FetchState<T>>(initialFetchState<T>());
  const alive = useRef(true);

  const load = useCallback(async () => {
    setState((s) => reduceFetchState(s, { type: 'start' }));
    try {
      const data = await fetcher();
      if (!alive.current) return;
      setState((s) =>
        reduceFetchState(s, {
          type: 'success',
          data,
          at: new Date().toISOString(),
        }),
      );
    } catch (e: unknown) {
      if (!alive.current) return;
      setState((s) =>
        reduceFetchState(s, {
          type: 'failure',
          message: e instanceof Error ? e.message : 'Erreur inconnue',
        }),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    alive.current = true;
    void load();
    const timer = setInterval(() => void load(), AUTO_REFRESH_MS);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [load]);

  return { ...state, refresh: load };
}
