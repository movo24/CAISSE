/**
 * Détection online/offline — navigator.onLine (rapide) + ping santé (fiable).
 * Calqué sur le syncEngine POS desktop.
 */
export type NetworkStatus = 'online' | 'offline';

const API_URL = import.meta.env.VITE_API_URL || '';

/** Ping réel du backend (HEAD /api/health), avec timeout court. */
export async function checkOnline(timeoutMs = 3000): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${API_URL}/api/health`, { method: 'HEAD', signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

/** S'abonne aux changements de connectivité. Retourne une fonction de désinscription. */
export function subscribeNetwork(onChange: (status: NetworkStatus) => void): () => void {
  const handler = () => onChange(navigator.onLine ? 'online' : 'offline');
  window.addEventListener('online', handler);
  window.addEventListener('offline', handler);
  return () => {
    window.removeEventListener('online', handler);
    window.removeEventListener('offline', handler);
  };
}
