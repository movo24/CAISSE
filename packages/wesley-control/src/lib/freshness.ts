/**
 * Data freshness state machine — the "never show a fake zero" rule.
 *
 * A screen's data is always in one of these states:
 *  - loading  : first fetch, nothing to show yet
 *  - fresh    : last fetch succeeded
 *  - stale    : a refresh FAILED but we still hold the last known data —
 *               the UI must keep showing it with a clear "données non
 *               actualisées" banner (never blank, never zeros)
 *  - error    : nothing was ever fetched successfully
 */
export interface FetchState<T> {
  status: 'loading' | 'fresh' | 'stale' | 'error';
  data: T | null;
  lastUpdatedAt: string | null;
  errorMessage: string | null;
  refreshing: boolean;
}

export function initialFetchState<T>(): FetchState<T> {
  return {
    status: 'loading',
    data: null,
    lastUpdatedAt: null,
    errorMessage: null,
    refreshing: false,
  };
}

export type FetchEvent<T> =
  | { type: 'start' }
  | { type: 'success'; data: T; at: string }
  | { type: 'failure'; message: string };

export function reduceFetchState<T>(
  prev: FetchState<T>,
  event: FetchEvent<T>,
): FetchState<T> {
  switch (event.type) {
    case 'start':
      return { ...prev, refreshing: true };
    case 'success':
      return {
        status: 'fresh',
        data: event.data,
        lastUpdatedAt: event.at,
        errorMessage: null,
        refreshing: false,
      };
    case 'failure':
      if (prev.data !== null) {
        // Keep the last known data, flag it stale — never a fake zero.
        return {
          ...prev,
          status: 'stale',
          errorMessage: event.message,
          refreshing: false,
        };
      }
      return {
        status: 'error',
        data: null,
        lastUpdatedAt: null,
        errorMessage: event.message,
        refreshing: false,
      };
  }
}

/** Human "il y a Xs / Xmin / HH:MM" label for the freshness banner. */
export function sinceLabel(lastUpdatedAt: string | null, now: Date): string {
  if (!lastUpdatedAt) return '—';
  const then = new Date(lastUpdatedAt).getTime();
  const secs = Math.max(0, Math.round((now.getTime() - then) / 1000));
  if (secs < 60) return `il y a ${secs} s`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `il y a ${mins} min`;
  const d = new Date(lastUpdatedAt);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `à ${hh}:${mm}`;
}
