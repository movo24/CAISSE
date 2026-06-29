/**
 * POS — Average basket (pure, unit-testable). Integer centimes.
 * Extracted from reports (behavior-preserving): the same revenue/transaction-count
 * average appeared in the daily summary and the Z-report aggregate; consolidated here.
 */

/** Average basket = round(totalRevenue / txCount); 0 when no transactions. */
export function averageBasket(totalRevenueMinorUnits: number, txCount: number): number {
  return txCount > 0 ? Math.round(totalRevenueMinorUnits / txCount) : 0;
}
