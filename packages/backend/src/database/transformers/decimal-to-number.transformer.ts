import { ValueTransformer } from 'typeorm';

/**
 * Le driver pg renvoie les colonnes `decimal`/`numeric` en STRING (précision
 * arbitraire côté Postgres). Sans ce transformer, un taux relu en base entre
 * dans l'arithmétique JS comme string — `100 + '20.00'` concatène en
 * '10020.00' et a produit des TVA ~100x trop faibles (bug TVA du 2026-07-18,
 * prouvé par test/sales-tax-rate-numeric.pg.spec.ts sur vrai Postgres ; les
 * specs unitaires mockent des nombres et ne le voient pas).
 *
 * À poser sur toute colonne decimal dont la valeur sert à un CALCUL.
 * Les taux (TVA, remises) tiennent sans perte dans un double IEEE 754 —
 * pas de risque de précision ici ; les montants restent des integers.
 */
export const decimalToNumber: ValueTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value === null ? null : parseFloat(value)),
};
