/**
 * MODE TEST pilote — décision PURE du contournement de verrou de session,
 * côté serveur (`POS_SESSION_TEST_BYPASS`, autorisé par l'owner en phase pilote).
 *
 * Le serveur n'accepte de marquer une vente comme vente de TEST (`is_test = true`)
 * QUE si le bypass est activé côté serveur (env `POS_SESSION_TEST_BYPASS=true`) et
 * — quand une liste blanche existe — que le magasin ET le terminal en font partie.
 *
 * Invariants (règles owner) :
 *  - la parole du client seule ne peut jamais soustraire une vente réelle aux
 *    rapports : c'est le SERVEUR qui autorise (règle 3) ;
 *  - hors mode test autorisé → `false` → comportement inchangé (règle 8) ;
 *  - périmètre limité au magasin/terminaux pilotes (règle 4) ;
 *  - désactivable instantanément par variable d'env, sans code (règle 7).
 *
 * Fonction pure : l'environnement est passé en argument (aucun accès direct à
 * `process.env`) → testable de façon déterministe.
 */
export type SessionTestBypassEnv = Record<string, string | undefined> & {
  POS_SESSION_TEST_BYPASS?: string;
  POS_SESSION_TEST_BYPASS_STORES?: string;
  POS_SESSION_TEST_BYPASS_TERMINALS?: string;
};

/** Un CSV vide/absent = pas de restriction ; sinon la valeur doit y figurer. */
function inAllowlist(csv: string | undefined, value: string | null | undefined): boolean {
  const list = (csv ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0) return true; // pas de liste → pas de restriction
  if (!value) return false; // liste présente mais valeur inconnue → refus
  return list.includes(value.trim());
}

export function isSessionTestBypassEnabled(
  env: SessionTestBypassEnv,
  storeId: string,
  terminalId?: string | null,
): boolean {
  if (env.POS_SESSION_TEST_BYPASS !== 'true') return false;
  return (
    inAllowlist(env.POS_SESSION_TEST_BYPASS_STORES, storeId) &&
    inAllowlist(env.POS_SESSION_TEST_BYPASS_TERMINALS, terminalId)
  );
}
