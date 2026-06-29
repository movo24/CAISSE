/**
 * POS — Stock-locations quantity helpers (pure, unit-testable).
 * Extracted from StockLocationsService (behavior-preserving): positive-quantity
 * guard, dispatch total, and sufficient-stock check.
 */

/** True when a movement quantity is strictly positive (legacy `q > 0` / reject `<= 0`). */
export function isPositiveQuantity(q: number): boolean {
  return Number.isFinite(q) && q > 0;
}

/** Sum of per-destination dispatch quantities. */
export function sumDispatchQuantities(
  dispatches: { quantity: number }[],
): number {
  return dispatches.reduce((s, d) => s + d.quantity, 0);
}

/** True when `available` covers `required` (legacy `available >= required`). */
export function hasSufficientStock(available: number, required: number): boolean {
  return available >= required;
}
