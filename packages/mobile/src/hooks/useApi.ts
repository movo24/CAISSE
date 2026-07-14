// ── useApi — fetch lecture seule + états + cache hors-ligne ──────
// Contrat d'affichage (P366) :
//  - loading : squelette propre, jamais de valeur fantôme ;
//  - erreur  : message précis + bouton réessayer, JAMAIS avalée ;
//  - hors ligne : dernières données synchronisées + horodatage ;
//  - donnée absente : « Donnée indisponible », jamais inventée.
// ─────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import { cacheGet, cacheSet } from '../lib/cache';

export interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** Horodatage de la donnée affichée (réseau ou cache). */
  syncedAt: string | null;
  /** true si la donnée affichée vient du cache (hors ligne / erreur). */
  fromCache: boolean;
  reload: () => void;
}

export function useApi<T>(
  cacheKey: string,
  fetcher: () => Promise<{ data: T }>,
  deps: unknown[] = [],
  /** false = ne pas interroger (ex. aucune sélection) — aucun état d'erreur. */
  enabled = true,
): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [tick, setTick] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!enabled) {
      setData(null);
      setLoading(false);
      setError(null);
      return undefined;
    }
    setLoading(true);
    setError(null);
    fetcher()
      .then((res) => {
        if (cancelled || !alive.current) return;
        setData(res.data);
        setSyncedAt(new Date().toISOString());
        setFromCache(false);
        cacheSet(cacheKey, res.data);
      })
      .catch((e: any) => {
        if (cancelled || !alive.current) return;
        const cached = cacheGet<T>(cacheKey);
        if (cached) {
          setData(cached.data);
          setSyncedAt(cached.syncedAt);
          setFromCache(true);
        }
        const msg =
          e?.response?.status === 403
            ? 'Accès réservé aux profils manager et admin.'
            : e?.response?.data?.message ??
              (e?.message === 'Network Error'
                ? 'Hors ligne — dernières données synchronisées affichées.'
                : e?.message ?? 'Erreur de chargement.');
        setError(Array.isArray(msg) ? msg.join(' — ') : String(msg));
      })
      .finally(() => {
        if (!cancelled && alive.current) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, tick, enabled, ...deps]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  return { data, loading, error, syncedAt, fromCache, reload };
}
