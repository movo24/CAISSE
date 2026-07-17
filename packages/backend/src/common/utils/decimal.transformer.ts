import { ValueTransformer } from 'typeorm';

/**
 * Colonnes `decimal` → number côté TypeScript.
 *
 * Le driver pg renvoie les colonnes `decimal/numeric` en STRING (précision
 * arbitraire). Toute arithmétique JS non normalisée sur ces valeurs concatène
 * au lieu d'additionner — bug TVA réel : `100 + '20.00'` → '10020.00' →
 * `tax_total_minor_units` ~100× trop faible, scellé dans le hash v2
 * (constaté le 2026-07-18 sur vrai Postgres ; invisible en spec unitaire).
 *
 * Ce transformer garantit qu'une entité relue expose TOUJOURS un number.
 * Réservé aux TAUX (pourcentages, ex. tax_rate) : les montants d'argent
 * restent des colonnes integer en centimes (règle « all money is integers »).
 */
export const decimalToNumber: ValueTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | number | null): number | null => {
    if (value === null || value === undefined) return null;
    const n = typeof value === 'number' ? value : parseFloat(value);
    return Number.isFinite(n) ? n : null;
  },
};
