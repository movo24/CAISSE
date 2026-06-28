/**
 * POS-080/083 — Pure stock-level classification helpers (no DB/Nest), so the threshold
 * logic is unit-testable and shared between the alerts query and the decrement path.
 *
 * The current data model uses ABSOLUTE per-product thresholds
 * (`stock_alert_threshold` default 10, `stock_critical_threshold` default 5).
 * There is NO baseline/par/max/reorder column, so a RELATIVE "20% low-stock" rule
 * (POS-083) has no defined reference yet — see `relativeThreshold` note + TECHNICAL_DEBT.
 */

export type StockLevel = 'out_of_stock' | 'critical' | 'alert' | 'ok';

/** Classify a stock quantity against absolute alert/critical thresholds. */
export function classifyStockLevel(
  qty: number,
  alertThreshold: number,
  criticalThreshold: number,
): StockLevel {
  if (qty <= 0) return 'out_of_stock';
  if (qty <= criticalThreshold) return 'critical';
  if (qty <= alertThreshold) return 'alert';
  return 'ok';
}

/**
 * True when a quantity moving from `oldQty` to `newQty` crosses `threshold` downward.
 * Used to emit an alert exactly once, at the moment of crossing (not on every decrement).
 */
export function crossedDownward(
  oldQty: number,
  newQty: number,
  threshold: number,
): boolean {
  return newQty <= threshold && oldQty > threshold;
}

/**
 * POS-083 — compute an absolute alert threshold as a percentage of a baseline quantity.
 *
 * ⚠️ PRODUCT DECISION REQUIRED: the model has no baseline column. "20% of what?"
 * (initial stock? par level? max capacity? reorder point?) is undecided. This helper is
 * provided for when a baseline is defined; it is NOT wired into the live path yet.
 */
export function relativeThreshold(baselineQty: number, pct = 20): number {
  if (baselineQty <= 0) return 0;
  return Math.ceil(baselineQty * (pct / 100));
}

/**
 * POS-083 — effective low-stock alert threshold.
 * Returns 20% of the par/max baseline when a positive baseline is set,
 * otherwise falls back to the absolute `stock_alert_threshold` (no behavior change).
 */
export function effectiveAlertThreshold(
  baselineQty: number | null | undefined,
  absoluteAlertThreshold: number,
  pct = 20,
): number {
  if (baselineQty && baselineQty > 0) return relativeThreshold(baselineQty, pct);
  return absoluteAlertThreshold;
}
