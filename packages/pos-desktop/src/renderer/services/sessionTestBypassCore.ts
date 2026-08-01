/**
 * MODE TEST pilote — cœur PUR (aucune dépendance au store ni à l'API), pour être
 * importable sans cycle par le store ET par le service. Voir sessionTestBypass.ts
 * pour le point d'entrée qui combine cette décision avec le magasin/terminal courants.
 */

export interface SessionTestBypassConfig {
  enabled: boolean;
  /** CSV d'identifiants magasin pilotes (storeId et/ou SIRET). Vide = tous. */
  stores: string;
  /** CSV de terminaux pilotes (ex. « TERMINAL 01 »). Vide = tous. */
  terminals: string;
}

/** Un CSV vide/absent = pas de restriction ; sinon au moins une valeur doit matcher. */
export function matchesAllowlist(csv: string, candidates: Array<string | null | undefined>): boolean {
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

/** Lit la configuration exposée par le shell desktop (ou désactivé hors desktop).
 *  Utilise `globalThis` (défini en Node comme dans le renderer Electron où
 *  `window === globalThis`) pour ne jamais lever « window is not defined ». */
export function readSessionTestBypassConfig(): SessionTestBypassConfig {
  const cfg = (globalThis as any)?.posDesktop?.sessionTestBypass as SessionTestBypassConfig | undefined;
  if (cfg && typeof cfg.enabled === 'boolean') return cfg;
  return { enabled: false, stores: '', terminals: '' };
}
