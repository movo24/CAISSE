import { useCallback, useEffect, useState } from 'react';
import { usePOSStore } from '../stores/posStore';
import { useOfflineStore } from '../stores/offlineStore';
import type { PosUpdateState } from '../types/pos-updater';

/**
 * Pont renderer ↔ contrôleur de mise à jour (main). Il :
 *  - s'abonne à l'état de mise à jour (version, phase, canal, progression) ;
 *  - REMONTE l'activité de la caisse au main pour garder l'installation sûre :
 *    tant qu'un panier est ouvert (scan → paiement → impression, le panier
 *    n'est vidé qu'après le ticket) ou qu'une sync tourne, l'installation
 *    manuelle est refusée côté main. L'installation automatique, elle, ne se
 *    fait qu'à la fermeture de l'app (jamais en pleine vente).
 *
 * En build web (`window.posUpdater` absent) : no-op, `state` reste null.
 */
export function useAutoUpdate() {
  const [state, setState] = useState<PosUpdateState | null>(null);
  const cartCount = usePOSStore((s) => s.cartItems.length);
  const isSyncing = useOfflineStore((s) => s.isSyncing);

  useEffect(() => {
    const u = window.posUpdater;
    if (!u) return;
    u.getState().then(setState).catch(() => {});
    return u.onEvent(setState);
  }, []);

  // Le panier ouvert couvre conservativement paiement + impression (le panier
  // est vidé APRÈS le ticket) → installation manuelle bloquée sur toute vente.
  useEffect(() => {
    window.posUpdater?.setActivity({ saleInProgress: cartCount > 0, syncing: isSyncing });
  }, [cartCount, isSyncing]);

  const installNow = useCallback(async () => {
    return (await window.posUpdater?.installNow()) ?? { ok: false, reason: 'unavailable' };
  }, []);
  const check = useCallback(() => {
    window.posUpdater?.check();
  }, []);
  const setChannel = useCallback((channel: 'stable' | 'pilot') => {
    window.posUpdater?.setChannel(channel);
  }, []);

  return { state, installNow, check, setChannel };
}
