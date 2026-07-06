/**
 * French SIREN / SIRET client-side validation (pure, unit-testable).
 * Mirrors the backend rules for live form feedback: the backend re-validates
 * authoritatively on save.
 */

export function digitsOnly(s: string | null | undefined): string {
  return (s || '').replace(/\D/g, '');
}

export function isValidLuhn(num: string): boolean {
  if (!/^\d+$/.test(num)) return false;
  let sum = 0;
  let double = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = num.charCodeAt(i) - 48;
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

const LA_POSTE_SIREN = '356000000';

export function isValidSiren(raw: string): boolean {
  const s = digitsOnly(raw);
  return s.length === 9 && isValidLuhn(s);
}

export function isValidSiret(raw: string): boolean {
  const s = digitsOnly(raw);
  if (s.length !== 14) return false;
  if (s.startsWith(LA_POSTE_SIREN)) return true;
  return isValidLuhn(s);
}

export function sirenFromSiret(raw: string): string | null {
  const s = digitsOnly(raw);
  return s.length >= 9 ? s.slice(0, 9) : null;
}

export interface LegalCheck {
  /** SIREN to display (auto-filled from the SIRET when the SIREN is empty). */
  siren: string;
  sirenError: string | null;
  siretError: string | null;
  /** True when the SIREN was auto-filled from the SIRET. */
  sirenAutoFilled: boolean;
}

/** Live check for the SIREN/SIRET pair — returns errors + an auto-filled SIREN. */
export function checkLegalIds(rawSiren: string, rawSiret: string): LegalCheck {
  const siret = digitsOnly(rawSiret);
  let siren = digitsOnly(rawSiren);
  let sirenAutoFilled = false;
  if (!siren && siret) {
    const derived = sirenFromSiret(siret);
    if (derived) { siren = derived; sirenAutoFilled = true; }
  }

  let sirenError: string | null = null;
  if (siren) {
    if (siren.length !== 9) sirenError = 'Le SIREN doit contenir 9 chiffres.';
    else if (!isValidSiren(siren)) sirenError = 'SIREN invalide (clé de contrôle).';
  }

  let siretError: string | null = null;
  if (siret) {
    if (siret.length !== 14) siretError = 'Le SIRET doit contenir 14 chiffres.';
    else if (siren.length === 9 && !siret.startsWith(siren)) siretError = `Le SIRET doit commencer par le SIREN (${siren}).`;
    else if (!isValidSiret(siret)) siretError = 'SIRET invalide (clé de contrôle).';
  }

  return { siren, sirenError, siretError, sirenAutoFilled };
}
