/**
 * POS — Sale discount totals (pure, unit-testable). Integer centimes.
 * Extracted from SalesService.createSale (behavior-preserving): the employee
 * discount cap amount and the discount-% of subtotal reported in the audit trail.
 * Complements discount-policy.ts (manual discount evaluation).
 */

/** Max discount allowed in centimes for an employee cap (floor of subtotal × pct%). */
export function computeMaxAllowedDiscount(
  subtotalMinorUnits: number,
  maxDiscountPct: number,
): number {
  return Math.floor(subtotalMinorUnits * (maxDiscountPct / 100));
}

/**
 * Discount as a percentage of subtotal, rounded to 2 decimals.
 * Returns null when subtotal is 0 (matches legacy audit payload).
 */
export function discountPercentOfSubtotal(
  totalDiscountMinorUnits: number,
  subtotalMinorUnits: number,
): number | null {
  if (subtotalMinorUnits <= 0) return null;
  return Math.round((totalDiscountMinorUnits / subtotalMinorUnits) * 10000) / 100;
}
