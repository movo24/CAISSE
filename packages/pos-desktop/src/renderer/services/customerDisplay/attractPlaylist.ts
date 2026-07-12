/**
 * Customer Display — attract playlist (Bloc 4).
 *
 * Récupère la playlist attract active de la caisse depuis le backend
 * (`GET /attract/playlist?terminalId=`) et fournit la logique PURE de
 * séquencement (avance, durée d'image, préchargement) — testable sans DOM.
 *
 * Principe : le serveur résout la campagne prioritaire (magasin > national,
 * fenêtre de dates, ciblage caisse) et renvoie une playlist ORDONNÉE. L'écran
 * client joue les médias les uns après les autres, précharge le suivant, puis
 * boucle. Si l'endpoint est indisponible (hors-ligne, non déployé, 401, vide),
 * on renvoie `null` et l'appelant retombe sur son comportement existant
 * (vidéo unique IndexedDB, sinon branding) — jamais de trou.
 */
import api from '../api';

export interface AttractMediaItem {
  type: 'video' | 'image';
  url: string;
  /** Durée d'affichage pour une image (secondes). Ignoré pour la vidéo. */
  durationSeconds: number | null;
}

export interface AttractPlaylist {
  campaignId: string;
  media: AttractMediaItem[];
  loop: boolean;
}

/** Durée d'affichage par défaut d'une image si le backend n'en fournit pas. */
export const DEFAULT_IMAGE_DURATION_SECONDS = 7;

/**
 * Récupère la playlist active. Renvoie `null` sur toute erreur ou playlist
 * vide — l'appelant doit dégrader proprement (ne jamais jeter côté écran).
 */
export async function fetchAttractPlaylist(
  terminalId: string | null,
): Promise<AttractPlaylist | null> {
  try {
    const { data } = await api.get('/attract/playlist', {
      params: terminalId ? { terminalId } : undefined,
    });
    return normalizePlaylist(data);
  } catch {
    return null;
  }
}

/**
 * Valide/normalise une réponse serveur en playlist sûre. Filtre les médias
 * sans URL exploitable ; renvoie `null` si rien de jouable ne reste.
 */
export function normalizePlaylist(raw: unknown): AttractPlaylist | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const rawMedia = Array.isArray(obj.media) ? obj.media : [];
  const media: AttractMediaItem[] = [];
  for (const m of rawMedia) {
    if (!m || typeof m !== 'object') continue;
    const mo = m as Record<string, unknown>;
    const url = typeof mo.url === 'string' ? mo.url.trim() : '';
    if (!url) continue;
    const type = mo.type === 'image' ? 'image' : 'video';
    const d =
      typeof mo.durationSeconds === 'number' && mo.durationSeconds > 0
        ? mo.durationSeconds
        : null;
    media.push({ type, url, durationSeconds: d });
  }
  if (media.length === 0) return null;
  return {
    campaignId: typeof obj.campaignId === 'string' ? obj.campaignId : '',
    media,
    loop: obj.loop !== false, // boucle par défaut
  };
}

/**
 * Indice suivant dans la playlist.
 * - boucle activée → revient à 0 après le dernier ;
 * - boucle désactivée → renvoie `null` après le dernier (fin de lecture).
 */
export function advance(index: number, length: number, loop: boolean): number | null {
  if (length <= 0) return null;
  const next = index + 1;
  if (next < length) return next;
  return loop ? 0 : null;
}

/** URL du média à précharger (le suivant, en tenant compte de la boucle). */
export function preloadUrl(
  media: AttractMediaItem[],
  index: number,
  loop: boolean,
): string | null {
  const next = advance(index, media.length, loop);
  return next === null ? null : media[next].url;
}

/** Durée effective (ms) d'affichage d'une image. */
export function imageDurationMs(item: AttractMediaItem): number {
  const s = item.durationSeconds && item.durationSeconds > 0
    ? item.durationSeconds
    : DEFAULT_IMAGE_DURATION_SECONDS;
  return Math.round(s * 1000);
}
