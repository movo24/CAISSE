import { posTerminalId } from './api';
import { usePOSStore } from '../stores/posStore';

/**
 * MODE TEST pilote — contournement TEMPORAIRE du verrou de session de caisse.
 *
 * Contexte : `GET /pos-sessions/active` renvoie 500 en production (cause
 * définitive traitée séparément), donc l'ouverture de session échoue et la garde
 * fiscale bloque tout encaissement. L'owner a AUTORISÉ, en phase pilote de test,
 * à contourner ce verrou même si l'invariant de session est violé — à condition
 * que ce soit :
 *   - activable/désactivable INSTANTANÉMENT par variable d'environnement, sans
 *     nouvelle build (règle 7) ;
 *   - limité au magasin et aux terminaux pilotes (règle 4) ;
 *   - inerte hors mode test → comportement de sécurité normal (règle 8).
 *
 * La configuration vient EXCLUSIVEMENT du process main (variables d'env système),
 * lue au preload et exposée en lecture seule via `window.posDesktop.sessionTestBypass`.
 * Le renderer ne peut jamais l'activer lui-même.
 */

export interface SessionTestBypassConfig {
  enabled: boolean;
  /** CSV d'identifiants magasin pilotes (storeId et/ou SIRET). Vide = tous. */
  stores: string;
  /** CSV de terminaux pilotes (ex. « TERMINAL 01 »). Vide = tous. */
  terminals: string;
}

/** Un CSV vide/absent = pas de restriction ; sinon au moins une valeur doit matcher. */
function matchesAllowlist(csv: string, candidates: Array<string | null | undefined>): boolean {
  const list = (csv || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0) return true; // pas de liste → pas de restriction
  const present = candidates.map((c) => (c ?? '').toString().trim()).filter(Boolean);
  return present.some((c) => list.includes(c));
}

/**
 * Décision PURE : le mode test est-il actif pour ce magasin + ce terminal ?
 * Miroir exact de la garde serveur (`session-test-bypass.util.ts`).
 */
export function decideSessionTestBypass(
  cfg: SessionTestBypassConfig | null | undefined,
  ctx: { storeIds: Array<string | null | undefined>; terminalId: string | null | undefined },
): boolean {
  if (!cfg?.enabled) return false;
  return (
    matchesAllowlist(cfg.stores, ctx.storeIds) &&
    matchesAllowlist(cfg.terminals, [ctx.terminalId])
  );
}

/** Lit la configuration exposée par le shell desktop (ou désactivé hors desktop). */
export function readSessionTestBypassConfig(): SessionTestBypassConfig {
  const cfg = (window as any)?.posDesktop?.sessionTestBypass as SessionTestBypassConfig | undefined;
  if (cfg && typeof cfg.enabled === 'boolean') return cfg;
  return { enabled: false, stores: '', terminals: '' };
}

/**
 * Le mode test est-il actif ICI, MAINTENANT ? Combine la config env du shell
 * avec le magasin courant (storeId du caissier + SIRET) et le terminal courant.
 * Utilisé pour lever la garde de session ET pour marquer les ventes `isTest`.
 */
export function isSessionTestBypassActive(): boolean {
  const cfg = readSessionTestBypassConfig();
  if (!cfg.enabled) return false;
  const st = usePOSStore.getState();
  const storeIds = [st.employee?.storeId, st.storeInfo?.siret];
  return decideSessionTestBypass(cfg, { storeIds, terminalId: posTerminalId() });
}
