/**
 * POS-085 — Inventory stock adjustment & variance (pure, unit-testable).
 * Extracted from InventoryScanService.applyScansToStock (behavior-preserving).
 *
 *  - delta    : receiving / adjustment / return → new = max(0, current + value)
 *  - absolute : inventory count → new = max(0, value)   (the physical count replaces stock)
 *
 * Variance (écart) compares a physical count to the system-expected quantity.
 */

export type AdjustMode = 'absolute' | 'delta';

export function applyStockAdjustment(
  mode: AdjustMode,
  currentQty: number,
  value: number,
): number {
  return mode === 'delta'
    ? Math.max(0, currentQty + value)
    : Math.max(0, value);
}

/** Variance = counted (physical) − expected (system). >0 surplus, <0 manquant. */
export function inventoryVariance(countedQty: number, expectedQty: number): number {
  return countedQty - expectedQty;
}
