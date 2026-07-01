/**
 * POS-080/083 — Pure stock-level classification helpers (no DB/Nest), so the threshold
 * logic is unit-testable and shared between the alerts query and the decrement path.
 *
 * Data model (since migration 1721-AddStockBaseline): ABSOLUTE per-product thresholds
 * (`stock_alert_threshold` default 10, `stock_critical_threshold` default 5) PLUS a
 * nullable `stock_baseline_quantity` (par/max). The RELATIVE 20% rule (POS-083) is LIVE:
 * `effectiveAlertThreshold` = 20% of the baseline when set, else the absolute threshold —
 * wired into BOTH the decrement path (stock.service) and the alerts SQL
 * (`getAlerts` COALESCE/CEIL predicate, proven against real SQL in
 * stock.service.pgmem.spec.ts / P278).
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
 * Decision settled: the baseline is `stock_baseline_quantity` (par/max, migration 1721,
 * nullable). Wired live via `effectiveAlertThreshold` below.
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

/**
 * Resulting stock quantity after an adjustment, clamped to ≥ 0.
 * - 'delta'   → oldQty + value
 * - 'absolute'→ value
 */
export function applyStockAdjustment(
  oldQty: number,
  value: number,
  mode: 'delta' | 'absolute',
): number {
  return Math.max(0, mode === 'delta' ? oldQty + value : value);
}
