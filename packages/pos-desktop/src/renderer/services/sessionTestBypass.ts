import { posTerminalId } from './api';
import { usePOSStore } from '../stores/posStore';
import {
  decideSessionTestBypass,
  readSessionTestBypassConfig,
  type SessionTestBypassConfig,
} from './sessionTestBypassCore';

/**
 * MODE TEST pilote — contournement TEMPORAIRE du verrou de session de caisse.
 *
 * Contexte : `GET /pos-sessions/active` (et `/open`) renvoie 500 en production
 * (dérive de schéma `pos_sessions`, corrigée par migration séparée), donc
 * l'ouverture de session échoue et la garde fiscale bloque tout encaissement.
 * L'owner a AUTORISÉ, en phase pilote de test, à contourner ce verrou même si
 * l'invariant de session est violé — activable/désactivable par variable d'env
 * (règle 7), limité au magasin/terminaux pilotes (règle 4), inerte hors mode
 * test (règle 8). La config vient EXCLUSIVEMENT du shell (main process).
 *
 * Le cœur pur (config + décision) vit dans `sessionTestBypassCore.ts` pour éviter
 * tout cycle d'import avec le store.
 */

export type { SessionTestBypassConfig } from './sessionTestBypassCore';
export {
  decideSessionTestBypass,
  readSessionTestBypassConfig,
} from './sessionTestBypassCore';

/**
 * Le mode test est-il actif ICI, MAINTENANT ? Combine la config env du shell
 * avec le magasin courant (storeId du caissier + SIRET) et le terminal courant.
 * Utilisé pour lever la garde de session, marquer les ventes de test, et
 * autoriser la session locale provisoire (5xx/timeout).
 */
export function isSessionTestBypassActive(): boolean {
  const cfg: SessionTestBypassConfig = readSessionTestBypassConfig();
  if (!cfg.enabled) return false;
  const st = usePOSStore.getState();
  const storeIds = [st.employee?.storeId, st.storeInfo?.siret];
  return decideSessionTestBypass(cfg, { storeIds, terminalId: posTerminalId() });
}
