/**
 * French business-identifier validation (SIREN / SIRET / TVA) — pure, testable.
 *
 * Rules implemented (per the store-identity mission):
 *  - SIREN = 9 digits + Luhn checksum;
 *  - SIRET = 14 digits + Luhn checksum, and MUST start with its SIREN;
 *  - if only the SIRET is given, the SIREN is auto-filled from its first 9 digits;
 *  - if both are given and inconsistent, a clear error is returned;
 *  - TVA intracommunautaire is never required, but a French company with a valid
 *    SIREN and no TVA number yields a (non-blocking) warning.
 *
 * Note: the SIRET Luhn check has a documented legal exception (La Poste,
 * SIREN 356000000). We special-case it so those establishments validate.
 */

/** Keep digits only. */
export function digitsOnly(s: string | null | undefined): string {
  return (s || '').replace(/\D/g, '');
}

/** Standard Luhn checksum validation over a numeric string. */
export function isValidLuhn(num: string): boolean {
  if (!/^\d+$/.test(num)) return false;
  let sum = 0;
  let double = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = num.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** La Poste SIREN — its SIRETs do not satisfy the Luhn checksum (legal exception). */
const LA_POSTE_SIREN = '356000000';

export function isValidSiren(raw: string | null | undefined): boolean {
  const s = digitsOnly(raw);
  return s.length === 9 && isValidLuhn(s);
}

export function isValidSiret(raw: string | null | undefined): boolean {
  const s = digitsOnly(raw);
  if (s.length !== 14) return false;
  if (s.startsWith(LA_POSTE_SIREN)) return true; // legal Luhn exception
  return isValidLuhn(s);
}

/** SIREN implied by a SIRET (its first 9 digits), or null if too short. */
export function sirenFromSiret(raw: string | null | undefined): string | null {
  const s = digitsOnly(raw);
  return s.length >= 9 ? s.slice(0, 9) : null;
}

/** The 2-digit French VAT key for a SIREN: (12 + 3·(SIREN mod 97)) mod 97. */
export function frenchVatKey(siren: string): number {
  return (12 + 3 * (Number(siren) % 97)) % 97;
}

/** Suggested French intra-community VAT number for a valid SIREN, else null. */
export function frenchVatNumber(raw: string | null | undefined): string | null {
  const s = digitsOnly(raw);
  if (s.length !== 9) return null;
  const key = String(frenchVatKey(s)).padStart(2, '0');
  return `FR${key}${s}`;
}

export interface LegalIdInput {
  siren?: string | null;
  siret?: string | null;
  vatNumber?: string | null;
  /** Whether the operating company is French (drives the TVA warning). */
  isFrench?: boolean;
}

export interface LegalIdResult {
  /** Normalised SIREN (digits only, possibly auto-filled from the SIRET). */
  siren: string | null;
  /** Normalised SIRET (digits only). */
  siret: string | null;
  /** Blocking problems — creation/update must be rejected if non-empty. */
  errors: string[];
  /** Non-blocking advisories (e.g. missing TVA). */
  warnings: string[];
}

/**
 * Reconcile + validate a SIREN/SIRET pair. Never throws. Auto-fills the SIREN
 * from the SIRET when the SIREN is missing; flags inconsistencies as errors.
 */
export function reconcileLegalIds(input: LegalIdInput): LegalIdResult {
  const rawSiren = digitsOnly(input.siren);
  const siret = digitsOnly(input.siret) || null;
  let siren = rawSiren || null;
  const errors: string[] = [];
  const warnings: string[] = [];

  // Auto-fill SIREN from SIRET when the SIREN is absent.
  if (!siren && siret) {
    siren = sirenFromSiret(siret);
  }

  if (siren) {
    if (siren.length !== 9) {
      errors.push('Le SIREN doit contenir exactement 9 chiffres.');
    } else if (!isValidSiren(siren)) {
      errors.push('SIREN invalide (clé de contrôle incorrecte).');
    }
  }

  if (siret) {
    if (siret.length !== 14) {
      errors.push('Le SIRET doit contenir exactement 14 chiffres.');
    } else {
      if (siren && siren.length === 9 && !siret.startsWith(siren)) {
        errors.push(`Le SIRET doit commencer par le SIREN (${siren}).`);
      }
      if (!isValidSiret(siret)) {
        errors.push('SIRET invalide (clé de contrôle incorrecte).');
      }
    }
  }

  // TVA advisory: French company with a valid SIREN but no VAT number.
  const hasVat = !!digitsOnly(input.vatNumber) || !!(input.vatNumber || '').trim();
  if (input.isFrench !== false && siren && isValidSiren(siren) && !hasVat) {
    warnings.push(
      'TVA intracommunautaire non renseignée pour une société française avec SIREN.',
    );
  }

  return { siren, siret, errors, warnings };
}
