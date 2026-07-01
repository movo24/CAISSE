/**
 * POS-INT-208 — Social payroll ENTRIES guard (pure, unit-testable).
 *
 * TD-INT-SOCIAL-ENTRIES: the social pre-accounting (social-preaccounting.ts) only
 * consolidates HR variables + a CSV justificatif. Posting REAL payroll/social
 * journal entries requires a chart of accounts validated by an accountant — a
 * business/accounting decision NOT made here. This guard refuses to treat social
 * entries as "postable" until such a validated chart is supplied. It does NOT
 * invent the mapping: it only declares the required semantic slots and demands a
 * code + explicit validation proof for each.
 *
 * The account slots reference the standard French PCG classes for documentation
 * only (641 rémunérations, 645 charges sociales patronales, 431 Sécurité sociale,
 * 421 personnel-rémunérations dues). The actual account codes MUST be filled by
 * the validated plan — this file decides nothing.
 */

/** Semantic slots a social posting chart must define (accountant fills the codes). */
export const REQUIRED_SOCIAL_ACCOUNT_SLOTS = [
  'grossSalaries', // ~ PCG 641
  'employerCharges', // ~ PCG 645
  'socialAgenciesPayable', // ~ PCG 431
  'netPayable', // ~ PCG 421
] as const;

export type SocialAccountSlot = (typeof REQUIRED_SOCIAL_ACCOUNT_SLOTS)[number];

export interface ValidatedSocialChart {
  accounts: Partial<Record<SocialAccountSlot, string>>;
  validatedBy?: string | null; // accountant identity — proof of validation
  validatedAt?: string | null; // ISO date of validation
}

export interface SocialGuardResult {
  allowed: boolean;
  reason?: string;
  missingSlots?: SocialAccountSlot[];
}

/**
 * Decide whether social journal entries may be posted.
 * Requires BOTH: env flag SOCIAL_ENTRIES_ENABLED=true|1 AND a fully validated chart
 * (every required slot has a non-empty code + validatedBy present). Otherwise blocked.
 */
export function canPostSocialEntries(
  envFlag: string | undefined | null,
  chart: ValidatedSocialChart | null | undefined,
): SocialGuardResult {
  const flagOn = envFlag === 'true' || envFlag === '1';
  if (!flagOn) {
    return { allowed: false, reason: 'Écritures sociales désactivées (SOCIAL_ENTRIES_ENABLED absent/≠true).' };
  }
  if (!chart) {
    return { allowed: false, reason: 'Aucun plan de comptes social fourni (validation comptable requise).' };
  }
  const missingSlots = REQUIRED_SOCIAL_ACCOUNT_SLOTS.filter(
    (slot) => !chart.accounts?.[slot] || String(chart.accounts[slot]).trim() === '',
  );
  if (missingSlots.length > 0) {
    return { allowed: false, reason: `Plan de comptes social incomplet.`, missingSlots };
  }
  if (!chart.validatedBy || String(chart.validatedBy).trim() === '') {
    return { allowed: false, reason: 'Plan de comptes social non validé (validatedBy manquant — preuve de validation comptable requise).' };
  }
  return { allowed: true };
}

/** Fail-closed assertion for any code path that would post social entries. */
export function assertSocialEntriesAllowed(
  envFlag: string | undefined | null,
  chart: ValidatedSocialChart | null | undefined,
): void {
  const r = canPostSocialEntries(envFlag, chart);
  if (!r.allowed) {
    throw new Error(
      `TD-INT-SOCIAL-ENTRIES bloqué: ${r.reason}${r.missingSlots ? ' [' + r.missingSlots.join(', ') + ']' : ''}`,
    );
  }
}
