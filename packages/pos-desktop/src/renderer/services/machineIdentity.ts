/**
 * Identité machine côté renderer (Partie B — enrôlement).
 *
 * Source de vérité = le bridge Electron `window.electronAPI.getMachineId()`
 * (UUID persistant en `userData`, stable au-delà du localStorage). On la met en
 * cache dans un module-level + localStorage pour un accès SYNCHRONE au moment
 * de construire les en-têtes de requête (`X-Machine-Id`).
 *
 * En build web (pas d'Electron), on retombe sur un UUID persistant en
 * localStorage — suffisant pour un environnement de test, jamais la cible
 * terrain (la caisse de production tourne sous Electron).
 */
const LS_KEY = 'pos_machine_id';

let cached: string | null = null;

type ElectronBridge = { getMachineId?: () => Promise<string> };

function browserFallbackId(): string {
  try {
    const existing = localStorage.getItem(LS_KEY);
    if (existing && existing.length >= 8) return existing;
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(LS_KEY, id);
    return id;
  } catch {
    return 'web-unknown';
  }
}

/**
 * Résout (une fois) l'identifiant machine et le met en cache. À appeler au
 * démarrage de l'app avant toute vente. Idempotent.
 */
export async function resolveMachineId(): Promise<string> {
  if (cached) return cached;
  const bridge = (window as unknown as { electronAPI?: ElectronBridge }).electronAPI;
  if (bridge?.getMachineId) {
    try {
      const id = (await bridge.getMachineId())?.trim();
      if (id && id.length >= 8) {
        cached = id;
        try {
          localStorage.setItem(LS_KEY, id);
        } catch {
          /* stockage indisponible → cache mémoire suffit */
        }
        return id;
      }
    } catch {
      // IPC indisponible → repli navigateur
    }
  }
  cached = browserFallbackId();
  return cached;
}

/** Lecture SYNCHRONE de l'identifiant machine mis en cache (en-têtes de requête). */
export function currentMachineId(): string {
  if (cached) return cached;
  try {
    const ls = localStorage.getItem(LS_KEY);
    if (ls) {
      cached = ls;
      return ls;
    }
  } catch {
    /* ignore */
  }
  return '';
}
