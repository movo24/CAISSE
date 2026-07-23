/**
 * Validation d'un code-barres GTIN (EAN-8, UPC-A 12, EAN-13) — miroir exact
 * de `packages/backend/src/common/validators/gtin.validator.ts` pour que la
 * fiche produit refuse en amont ce que le serveur refusera, avec un motif
 * précis (jeu de caractères / longueur / clé de contrôle).
 */
export type GtinIssue = 'empty' | 'charset' | 'length' | 'checksum';

/** Motif d'invalidité, ou null si le code est un GTIN valide. */
export function gtinIssue(raw: string): GtinIssue | null {
  const code = (raw || '').trim();
  if (!code) return 'empty';
  if (!/^\d+$/.test(code)) return 'charset';
  if (![8, 12, 13].includes(code.length)) return 'length';
  const digits = code.split('').map(Number);
  const check = digits.pop() as number;
  // Mod-10 GTIN : depuis le chiffre le plus à droite (hors clé), poids 3,1,3,1…
  let sum = 0;
  digits.reverse().forEach((d, i) => {
    sum += d * (i % 2 === 0 ? 3 : 1);
  });
  return (10 - (sum % 10)) % 10 === check ? null : 'checksum';
}

export function isValidGtin(raw: string): boolean {
  return gtinIssue(raw) === null;
}

export const GTIN_ISSUE_MESSAGE: Record<GtinIssue, string> = {
  empty: 'Le code EAN est obligatoire pour créer un produit.',
  charset: 'Code EAN invalide : uniquement des chiffres, sans lettres ni espaces.',
  length: 'Code EAN invalide : 8 ou 13 chiffres attendus.',
  checksum:
    'Code EAN invalide : clé de contrôle incorrecte — vérifiez la saisie (un chiffre est faux ou manquant).',
};

// ── Identifiants internes Wesley (environnement fermé — reconnu par GS1) ────
// Générés EXCLUSIVEMENT par le serveur (séquence atomique) et rendus en
// Code 128 standard non-GS1 : jamais un faux EAN.

export const WESLEY_CODE_REGEX = /^WES-P-\d{12}$/;

export function isWesleyCode(raw: string): boolean {
  return WESLEY_CODE_REGEX.test((raw || '').trim());
}

export type ProductCodeIssue = GtinIssue | 'wesley';

export const PRODUCT_CODE_ISSUE_MESSAGE: Record<ProductCodeIssue, string> = {
  ...GTIN_ISSUE_MESSAGE,
  wesley:
    'Code Wesley invalide : format attendu WES-P- suivi de 12 chiffres — utilisez « Générer un code-barres Wesley », ne le saisissez pas à la main.',
};

/**
 * Validation du code produit principal : GTIN valide OU code interne Wesley.
 * Un code qui COMMENCE par « WES » mais ne respecte pas le format reçoit un
 * message dédié (au lieu d'un message EAN trompeur).
 */
export function productCodeIssue(raw: string): ProductCodeIssue | null {
  const code = (raw || '').trim();
  if (!code) return 'empty';
  if (WESLEY_CODE_REGEX.test(code)) return null;
  if (/^wes/i.test(code)) return 'wesley';
  return gtinIssue(code);
}
