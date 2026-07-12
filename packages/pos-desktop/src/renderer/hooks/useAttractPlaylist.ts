import { useEffect, useState } from 'react';
import {
  fetchAttractPlaylist,
  type AttractPlaylist,
} from '../services/customerDisplay/attractPlaylist';

/**
 * Récupère la playlist attract active de la caisse et la rafraîchit
 * périodiquement (les campagnes changent côté backoffice sans redémarrage).
 *
 * Renvoie `null` tant qu'aucune playlist jouable n'est disponible (endpoint
 * absent/hors-ligne/vide) → l'écran client garde son comportement existant.
 *
 * @param terminalId caisse courante (ciblage campagne)
 * @param active     ne fetch que si l'attract est pertinent (mode ≠ branding)
 */
export function useAttractPlaylist(
  terminalId: string,
  active: boolean,
  refreshMs = 5 * 60 * 1000,
): AttractPlaylist | null {
  const [playlist, setPlaylist] = useState<AttractPlaylist | null>(null);

  useEffect(() => {
    if (!active) {
      setPlaylist(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const pl = await fetchAttractPlaylist(terminalId);
      if (!cancelled) setPlaylist(pl);
    };
    load();
    const iv = setInterval(load, Math.max(30_000, refreshMs));
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [terminalId, active, refreshMs]);

  return playlist;
}
