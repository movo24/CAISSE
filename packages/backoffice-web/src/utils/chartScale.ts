/**
 * Échelle SÛRE pour les graphiques à barres CSS du Dashboard.
 *
 * Bug d'origine (« Semaine en cours ») : le domaine était calculé UNIQUEMENT sur
 * la moyenne N-1 (`Math.max(...weekAvg, 1)`), jamais alimentée → toujours 0 →
 * max = 1 centime ; la hauteur `(réalisé / max) * 100 %` n'avait AUCUN plafond →
 * une vente de 10 € (1000 centimes) rendait une barre à 100 000 % qui traversait
 * tout le dashboard.
 *
 * Règles garanties ici :
 *  - toute valeur est convertie et validée (chaîne numérique acceptée) ;
 *  - NaN / Infinity / négatif / null / undefined → 0 (valeur sûre) ;
 *  - le domaine inclut TOUTES les séries réellement affichées ;
 *  - le maximum est STRICTEMENT positif (repli 1 si tout est à zéro) ;
 *  - une marge supérieure (headroom) garde la valeur max lisible ;
 *  - chaque hauteur est plafonnée à 100 % de la zone de tracé — jamais
 *    négative, jamais infinie, jamais au-delà.
 */

/** Convertit en nombre fini ≥ 0. Chaînes numériques acceptées ; le reste → 0. */
export function toFiniteNonNeg(value: unknown): number {
  const n = typeof value === 'string' ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

/** Marge supérieure par défaut : la plus grande barre culmine à ~95 %. */
export const CHART_HEADROOM = 1.05;

/**
 * Maximum STRICTEMENT positif de toutes les séries affichées, avec marge.
 * Toutes les valeurs sont assainies. Si tout vaut zéro → 1 (domaine de secours :
 * toutes les barres rendent 0 %, aucun artefact).
 */
export function chartMax(series: ReadonlyArray<ReadonlyArray<unknown>>, headroom: number = CHART_HEADROOM): number {
  let max = 0;
  for (const s of series) {
    for (const v of s) {
      const n = toFiniteNonNeg(v);
      if (n > max) max = n;
    }
  }
  if (max <= 0) return 1;
  const h = Number.isFinite(headroom) && headroom >= 1 ? headroom : 1;
  return max * h;
}

/**
 * Hauteur d'une barre en % de la zone de tracé : assainie et BORNÉE [0, 100].
 * `max` invalide (≤ 0, NaN, Infinity) → 0 % (jamais de division folle).
 */
export function barHeightPct(value: unknown, max: number): number {
  const v = toFiniteNonNeg(value);
  if (v <= 0) return 0;
  if (!Number.isFinite(max) || max <= 0) return 0;
  return Math.min((v / max) * 100, 100);
}
