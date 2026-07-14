// ── Cache lecture hors-ligne (localStorage) ──────────────────────
// Mode hors ligne = CONSULTATION des dernières données synchronisées,
// rien d'autre : aucune file d'écriture, aucune action différée.
// Chaque entrée porte son horodatage (affiché « dernière synchro »).
// Aucune donnée sensible n'est stockée ici (agrégats anonymes).
// ─────────────────────────────────────────────────────────────────

const PREFIX = 'pilotage:cache:';
const MAX_ENTRIES = 40;

export interface CachedEntry<T> {
  data: T;
  syncedAt: string; // ISO
}

export function cacheGet<T>(key: string): CachedEntry<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.syncedAt !== 'string') return null;
    return parsed as CachedEntry<T>;
  } catch {
    return null;
  }
}

export function cacheSet<T>(key: string, data: T): void {
  try {
    localStorage.setItem(
      PREFIX + key,
      JSON.stringify({ data, syncedAt: new Date().toISOString() }),
    );
    pruneCache();
  } catch {
    // Quota plein : le cache est un confort, jamais bloquant.
  }
}

/** Borne le nombre d'entrées (les plus anciennes sont supprimées). */
function pruneCache(): void {
  const entries: Array<{ k: string; t: number }> = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(PREFIX)) continue;
    try {
      const v = JSON.parse(localStorage.getItem(k) || '');
      entries.push({ k, t: new Date(v.syncedAt).getTime() || 0 });
    } catch {
      localStorage.removeItem(k);
    }
  }
  if (entries.length <= MAX_ENTRIES) return;
  entries
    .sort((a, b) => a.t - b.t)
    .slice(0, entries.length - MAX_ENTRIES)
    .forEach((e) => localStorage.removeItem(e.k));
}

export function clearCache(): void {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX)) keys.push(k);
  }
  keys.forEach((k) => localStorage.removeItem(k));
}
