import { useEffect, useRef } from 'react';

/**
 * Subscribe to the backend SSE stream of live store events (sales, …) and invoke
 * `onEvent` for each. Replaces aggressive polling on dashboards.
 *
 * EventSource cannot send headers, so the JWT is passed as a query param (the
 * backend verifies it). Gracefully no-ops if there is no token/store.
 */
export function useRealtimeSales(storeId: string | undefined, onEvent: (data: any) => void) {
  const cb = useRef(onEvent);
  cb.current = onEvent;

  useEffect(() => {
    if (!storeId) return;
    const token = localStorage.getItem('accessToken');
    if (!token) return;

    const base = import.meta.env.VITE_API_URL || '';
    const url = `${base}/api/realtime/sales?storeId=${encodeURIComponent(storeId)}&token=${encodeURIComponent(token)}`;

    let es: EventSource | null = null;
    try {
      es = new EventSource(url);
    } catch {
      return; // SSE unsupported — caller keeps its fallback polling
    }
    es.onmessage = (e) => {
      try { cb.current(JSON.parse(e.data)); } catch { /* ignore malformed frame */ }
    };
    // On error the browser auto-reconnects; nothing to do. (Token expiry will be
    // caught on reconnect — the dashboard's fallback polling still covers gaps.)
    return () => { es?.close(); };
  }, [storeId]);
}
