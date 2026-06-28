/**
 * POS — Loyalty points earned on a sale (pure, unit-testable).
 * Extracted from createSale (behavior-preserving): 1 point per 1€ of net total
 * (floor of totalMinorUnits / 100). Never negative.
 */
export function loyaltyPointsEarned(totalMinorUnits: number): number {
  if (totalMinorUnits <= 0) return 0;
  return Math.floor(totalMinorUnits / 100);
}
