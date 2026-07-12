/**
 * Edge-triggered stock-alert band crossing for the sale path.
 *
 * The sale emits a low/critical/out-of-stock alert (audit `stock_adjustment` +
 * TW24 push to managers) via `computeStockAlerts` + `logStockAlertsAsync`. That
 * emission used to fire whenever the post-sale quantity was at/below a threshold —
 * so a product already below its threshold **re-alerted on every subsequent sale**
 * (audit noise + repeated manager pushes). This helper makes it edge-triggered:
 * an alert fires ONLY when a sale moves the product into a MORE severe band, which
 * aligns the sale path with `StockService.decrementStock` (already edge-triggered).
 *
 * Pure and DB-agnostic → unit-testable without a database.
 */
export type StockAlertBand = 'out_of_stock' | 'critical' | 'alert' | 'none';

const SEVERITY: Record<StockAlertBand, number> = {
  none: 0,
  alert: 1,
  critical: 2,
  out_of_stock: 3,
};

export function classifyStockBand(
  qty: number,
  alertThreshold: number,
  criticalThreshold: number,
): StockAlertBand {
  if (qty <= 0) return 'out_of_stock';
  if (qty <= criticalThreshold) return 'critical';
  if (qty <= alertThreshold) return 'alert';
  return 'none';
}

/**
 * Returns the band to alert on ONLY when the sale (oldQty → newQty) moved the
 * product into a strictly more severe band; otherwise null (no alert). Escalation
 * within the low zone (alert → critical → out_of_stock) still fires; staying in the
 * same band, or recovering, does not.
 */
export function stockCrossingBand(
  oldQty: number,
  newQty: number,
  alertThreshold: number,
  criticalThreshold: number,
): Exclude<StockAlertBand, 'none'> | null {
  const oldBand = classifyStockBand(oldQty, alertThreshold, criticalThreshold);
  const newBand = classifyStockBand(newQty, alertThreshold, criticalThreshold);
  if (newBand !== 'none' && SEVERITY[newBand] > SEVERITY[oldBand]) {
    return newBand;
  }
  return null;
}
