/**
 * Edge-triggered low/critical stock alert detection, shared by the POS sale path.
 *
 * The sale decrements stock via inline conditional SQL that does NOT route through
 * `StockService.decrementStock`, so the at-sale-time low/critical alert that method
 * emits was never fired on a sale (only the polling views reflected it). This helper
 * restores that alert, edge-triggered EXACTLY like `StockService`: it fires only on
 * the decrement that CROSSES a threshold — old strictly above, new at or below — not
 * on every sale while the product is already below. Critical takes precedence over low.
 *
 * Pure and DB-agnostic so it is unit-testable without a database (the end-to-end wiring
 * is proven on real Postgres, where the decrement arithmetic is faithful — pg-mem is not).
 */
export type StockAlertLevel = 'critical' | 'alert';

export function detectStockThresholdCrossing(params: {
  oldStock: number;
  newStock: number;
  alertThreshold: number;
  criticalThreshold: number;
}): StockAlertLevel | null {
  const { oldStock, newStock, alertThreshold, criticalThreshold } = params;
  if (newStock <= criticalThreshold && oldStock > criticalThreshold) return 'critical';
  if (newStock <= alertThreshold && oldStock > alertThreshold) return 'alert';
  return null;
}
