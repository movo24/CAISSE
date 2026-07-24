/**
 * Échelle sûre des graphiques — anti-régression du bug « barre du vendredi »
 * (référence N-1 à zéro + une vente réelle → hauteur 100 000 % sans plafond).
 */
import { describe, it, expect } from 'vitest';
import { barHeightPct, chartMax, toFiniteNonNeg, CHART_HEADROOM } from './chartScale';

describe('toFiniteNonNeg', () => {
  it('nombres valides conservés ; chaînes numériques converties', () => {
    expect(toFiniteNonNeg(42)).toBe(42);
    expect(toFiniteNonNeg(0.5)).toBe(0.5);
    expect(toFiniteNonNeg('12.5')).toBe(12.5);
    expect(toFiniteNonNeg(' 1000 ')).toBe(1000);
  });

  it('NaN, Infinity, null, undefined, texte, négatif → 0 (valeur sûre)', () => {
    expect(toFiniteNonNeg(NaN)).toBe(0);
    expect(toFiniteNonNeg(Infinity)).toBe(0);
    expect(toFiniteNonNeg(-Infinity)).toBe(0);
    expect(toFiniteNonNeg(null)).toBe(0);
    expect(toFiniteNonNeg(undefined)).toBe(0);
    expect(toFiniteNonNeg('abc')).toBe(0);
    expect(toFiniteNonNeg(-50)).toBe(0); // négatif normalisé
  });
});

describe('chartMax — domaine sur TOUTES les séries affichées', () => {
  it('cas du bug : moyenne N-1 à zéro + vente réelle 10 € → le domaine inclut le réalisé', () => {
    const max = chartMax([[0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 1000, 0, 0]]);
    expect(max).toBe(1000 * CHART_HEADROOM);
  });

  it('tous les jours à 0 → domaine de secours strictement positif', () => {
    expect(chartMax([[0, 0, 0], [0, 0, 0]])).toBe(1);
  });

  it('valeurs corrompues (null, NaN, Infinity, chaînes, négatifs) assainies', () => {
    const max = chartMax([[null, NaN, Infinity, '500', -20]]);
    expect(max).toBe(500 * CHART_HEADROOM);
  });

  it('très petit et très grand montants gérés sans dégénérer', () => {
    expect(chartMax([[0.01]])).toBeCloseTo(0.01 * CHART_HEADROOM);
    expect(chartMax([[9_999_999_99]])).toBe(9_999_999_99 * CHART_HEADROOM);
  });
});

describe('barHeightPct — hauteur bornée [0, 100]', () => {
  it('cas du bug : 1000 centimes sur l’ancien max 1 aurait fait 100 000 % → borné à 100', () => {
    expect(barHeightPct(1000, 1)).toBe(100);
  });

  it('vente 10 € avec référence zéro : visible (~95 % avec headroom), jamais au-delà', () => {
    const max = chartMax([[0, 0, 0], [0, 1000, 0]]);
    const h = barHeightPct(1000, max);
    expect(h).toBeGreaterThan(90);
    expect(h).toBeLessThanOrEqual(100);
  });

  it('une seule journée avec ventes : proportions correctes, autres à 0 %', () => {
    const week = [0, 0, 0, 0, 1000, 0, 0];
    const max = chartMax([week]);
    expect(barHeightPct(week[0], max)).toBe(0);
    expect(barHeightPct(week[4], max)).toBeCloseTo(100 / CHART_HEADROOM, 5);
  });

  it('objectif/valeur à zéro → 0 %, jamais NaN ni négatif', () => {
    expect(barHeightPct(0, 1)).toBe(0);
    expect(barHeightPct(0, 0)).toBe(0);
  });

  it('max invalide (0, NaN, Infinity, négatif) → 0 % (aucune division folle)', () => {
    expect(barHeightPct(50, 0)).toBe(0);
    expect(barHeightPct(50, NaN)).toBe(0);
    expect(barHeightPct(50, Infinity)).toBe(0);
    expect(barHeightPct(50, -5)).toBe(0);
  });

  it('valeur corrompue (NaN, Infinity, chaîne non numérique, négative) → 0 %', () => {
    expect(barHeightPct(NaN, 100)).toBe(0);
    expect(barHeightPct(Infinity, 100)).toBe(0);
    expect(barHeightPct('abc', 100)).toBe(0);
    expect(barHeightPct(-10, 100)).toBe(0);
    expect(barHeightPct('50', 100)).toBe(50); // chaîne numérique OK
  });
});
