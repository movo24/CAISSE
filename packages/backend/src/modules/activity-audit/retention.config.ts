/**
 * Politique de rétention (spec §16) — durées PRUDENTES et configurables. La purge est
 * DÉSACTIVÉE par défaut (opt-in) : rien n'est supprimé en prod sans activation explicite,
 * la durée devant être validée juridiquement avant mise en production.
 *
 * Le journal d'audit des droits (access_audit_log) n'est JAMAIS purgé ici — il est
 * immuable et hash-chaîné ; sa conservation relève d'une obligation/politique distincte.
 */
export interface RetentionConfig {
  enabled: boolean;
  loginEventDays: number;
  viewEventDays: number; // consultations détaillées
  accessDeniedDays: number; // ACCESS_DENIED conservés plus longtemps
  sessionDays: number; // sessions terminées / révoquées
  geoDays: number; // au-delà : géo approximative effacée (ligne conservée)
}

function num(env: string | undefined, def: number): number {
  const n = env ? parseInt(env, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : def;
}

export function loadRetentionConfig(env: NodeJS.ProcessEnv = process.env): RetentionConfig {
  return {
    enabled: env.RETENTION_PURGE_ENABLED === 'true',
    loginEventDays: num(env.RETENTION_LOGIN_DAYS, 365), // 12 mois
    viewEventDays: num(env.RETENTION_VIEW_DAYS, 90), // 3 mois
    accessDeniedDays: num(env.RETENTION_ACCESS_DENIED_DAYS, 365), // 12 mois
    sessionDays: num(env.RETENTION_SESSION_DAYS, 365), // 12 mois
    geoDays: num(env.RETENTION_GEO_DAYS, 90), // 3 mois
  };
}
