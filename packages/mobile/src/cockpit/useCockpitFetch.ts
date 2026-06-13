import { useCallback, useEffect, useState } from 'react';

/** Minimal fetch-on-mount hook for the cockpit views (loading / error / refresh). */
export function useCockpitFetch<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    load()
      .then(setData)
      .catch((e: any) =>
        setError(e?.response?.status === 401 ? 'Session expirée — reconnecte-toi.' : 'Chargement impossible.'),
      )
      .finally(() => setLoading(false));
  }, deps);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, error, loading, refresh };
}
