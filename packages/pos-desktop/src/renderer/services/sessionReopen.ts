import { usePOSStore } from '../stores/posStore';
import { useOfflineStore } from '../stores/offlineStore';

/**
 * Proposition de RÉOUVERTURE de session au retour du serveur — GO owner nommé.
 *
 * Règle maison : JAMAIS de réouverture silencieuse. Quand le réseau repasse
 * `online` (transition du watcher — offline/degraded → online, jamais une
 * boucle) et qu'un caissier est connecté SANS session serveur, on PROPOSE :
 * le caissier saisit le contenu ACTUEL du tiroir comme fond (ce qui rend
 * l'attendu correct pour la suite du service), ou refuse (« Plus tard » —
 * reproposé à la prochaine transition seulement). Les ventes ne sont JAMAIS
 * bloquées pendant l'attente du choix. Aucun rattachement rétroactif des
 * ventes déjà passées (« no UPDATE on validated sale »).
 */

/** Décision PURE : proposer la réouverture sur cette transition réseau ? */
export function shouldOfferReopen(opts: {
  prevStatus: string;
  nextStatus: string;
  hasEmployee: boolean;
  hasSession: boolean;
}): boolean {
  return (
    opts.prevStatus !== 'online' &&
    opts.nextStatus === 'online' &&
    opts.hasEmployee &&
    !opts.hasSession
  );
}

let unsubscribe: (() => void) | null = null;

/** Accroche le watcher aux TRANSITIONS du statut réseau (idempotent). */
export function initSessionReopenWatcher(): void {
  if (unsubscribe) return;
  let prev = useOfflineStore.getState().networkStatus;
  unsubscribe = useOfflineStore.subscribe((state) => {
    const next = state.networkStatus;
    if (next !== prev) {
      const pos = usePOSStore.getState();
      if (
        shouldOfferReopen({
          prevStatus: prev,
          nextStatus: next,
          hasEmployee: !!pos.employee,
          hasSession: !!pos.posSession,
        })
      ) {
        usePOSStore.setState({ sessionReopenOffered: true });
      }
      prev = next;
    }
  });
}

/** Réservé aux tests : détache le watcher. */
export function disposeSessionReopenWatcher(): void {
  unsubscribe?.();
  unsubscribe = null;
}
