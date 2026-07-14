/**
 * POS — Recommendation scoring (pure, unit-testable).
 * Extracted from AiLearningService.getProductPerformance (behavior-preserving):
 * CTR/conversion rates and the blacklist / penalize / boost scoring decision.
 */

export const BLACKLIST_CTR_THRESHOLD = 0.03; // < 3% CTR after enough displays → blacklist
export const BLACKLIST_MIN_DISPLAYS = 20; // need 20+ displays before judging
export const PENALTY_CTR_THRESHOLD = 0.05; // < 5% CTR → penalize
export const BOOST_CONVERSION_THRESHOLD = 0.1; // ≥ 10% conversion → boost

export type RecoStatus = 'active' | 'penalized' | 'blacklisted';

/** Safe rate: numerator/denominator, or 0 when denominator is 0. */
export function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

/**
 * Performance score (0–1) + status from display volume, CTR and conversion.
 * Below the minimum display count the score stays neutral (0.5, active).
 */
export function scoreRecommendation(
  totalDisplayed: number,
  ctr: number,
  conversionRate: number,
): { performanceScore: number; status: RecoStatus } {
  if (totalDisplayed < BLACKLIST_MIN_DISPLAYS) {
    return { performanceScore: 0.5, status: 'active' };
  }
  if (ctr < BLACKLIST_CTR_THRESHOLD) {
    return { performanceScore: 0.0, status: 'blacklisted' };
  }
  if (ctr < PENALTY_CTR_THRESHOLD) {
    return { performanceScore: 0.2, status: 'penalized' };
  }
  if (conversionRate >= BOOST_CONVERSION_THRESHOLD) {
    return { performanceScore: 1.0, status: 'active' };
  }
  return {
    performanceScore: Math.min(1, ctr * 5 + conversionRate * 3),
    status: 'active',
  };
}
