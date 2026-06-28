/**
 * POS-046 — Return / refund math (pure, no DB/Nest → unit-testable).
 * Extracted from ReturnsService.createReturn (behavior-preserving).
 *
 * - returnableQuantity: how many units of a sold line may still be returned.
 * - computeLineRefund: refund for a partial return, proportional to the net line total
 *   (so a discounted line refunds proportionally, never more than what was paid).
 * All amounts are integer minor units (centimes).
 */

/** Units still returnable for a line = sold − already returned (never negative). */
export function returnableQuantity(soldQty: number, alreadyReturned: number): number {
  return Math.max(0, soldQty - alreadyReturned);
}

/**
 * Refund for `requestedQty` units of a line, proportional to its NET total.
 * Rounded to the nearest cent (matches the original inline behavior).
 */
export function computeLineRefund(
  lineTotalMinorUnits: number,
  requestedQty: number,
  soldQty: number,
): number {
  if (soldQty <= 0) return 0;
  return Math.round((lineTotalMinorUnits * requestedQty) / soldQty);
}
