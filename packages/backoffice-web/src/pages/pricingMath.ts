import { parseFr } from './productForm';

/**
 * Tarification HT ↔ TTC — logique PURE (fiche produit).
 *
 * Convention anti-dérive : le champ ÉDITÉ par l'utilisateur est la source de
 * vérité de la saisie ; l'autre sens est dérivé et arrondi AU CENTIME. Le
 * stockage reste le TTC en centimes (colonne existante priceMinorUnits).
 *
 * Propriété prouvée par les tests : pour tout montant en centimes x ≥ 0 et
 * tout taux t > 0, htFromTtc(ttcFromHt(x, t), t) === x — car
 * round(round(x·k)/k) = x dès que k = 1 + t/100 > 1 (l'erreur d'arrondi
 * |e| ≤ 0,5 devient |e/k| < 0,5). Le cycle HT→TTC→HT ne dérive donc jamais.
 */

/** TTC (centimes) depuis HT (centimes) au taux t (%) — arrondi au centime. */
export function ttcFromHt(htMinor: number, taxRatePct: number): number {
  return Math.round(htMinor * (1 + taxRatePct / 100));
}

/** HT (centimes) depuis TTC (centimes) au taux t (%) — arrondi au centime. */
export function htFromTtc(ttcMinor: number, taxRatePct: number): number {
  return Math.round(ttcMinor / (1 + taxRatePct / 100));
}

/** Saisie utilisateur (euros, virgule française acceptée) → centimes, ou null. */
export function eurosInputToMinor(input: string): number | null {
  const v = parseFr(input);
  return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : null;
}

/** Centimes → chaîne de saisie française à 2 décimales (« 12,50 »). */
export function minorToEurosInput(minor: number): string {
  return (minor / 100).toFixed(2).replace('.', ',');
}

/** Taux de TVA saisi (virgule acceptée) — null si invalide/négatif. */
export function parseTaxRate(input: string): number | null {
  const t = parseFr(input);
  return Number.isFinite(t) && t >= 0 ? t : null;
}
