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
 *
 * POS-INT-127 — uses CUMULATIVE rounding so that, no matter how a line is split
 * across several partial returns, the sum of all refunds for a fully-returned
 * line equals its line total EXACTLY (no lost/over-refunded centime). The refund
 * of a batch is `round(total·(prev+req)/sold) − round(total·prev/sold)` where
 * `prev` = units already returned. Back-compatible: with `prev=0` and a single
 * return this equals the previous `round(total·req/sold)`, and a full return
 * (`req=sold`) yields exactly the line total.
 */
export function computeLineRefund(
  lineTotalMinorUnits: number,
  requestedQty: number,
  soldQty: number,
  alreadyReturnedQty = 0,
): number {
  if (soldQty <= 0) return 0;
  const cum = (n: number) => Math.round((lineTotalMinorUnits * n) / soldQty);
  return cum(alreadyReturnedQty + requestedQty) - cum(alreadyReturnedQty);
}
