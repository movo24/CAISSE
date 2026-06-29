/**
 * POS — Store network helpers (pure, unit-testable).
 * Extracted from StoresService (behavior-preserving): network totals/avg ticket
 * aggregation and the TimeWin24 status mapping.
 */

export interface StoreTotals {
  totalRevenue: number;
  totalSales: number;
  todayRevenue: number;
  todaySales: number;
}

export interface NetworkTotals extends StoreTotals {
  avgTicket: number;
}

/** Aggregate per-store totals into network totals + network average ticket. */
export function aggregateNetworkTotals(stats: StoreTotals[]): NetworkTotals {
  const totalRevenue = stats.reduce((s, st) => s + st.totalRevenue, 0);
  const totalSales = stats.reduce((s, st) => s + st.totalSales, 0);
  const todayRevenue = stats.reduce((s, st) => s + st.todayRevenue, 0);
  const todaySales = stats.reduce((s, st) => s + st.todaySales, 0);
  return {
    totalRevenue,
    totalSales,
    avgTicket: totalSales > 0 ? Math.round(totalRevenue / totalSales) : 0,
    todayRevenue,
    todaySales,
  };
}

/** Map a TimeWin24 store status to the CAISSE `isActive` flag. */
export function isTimeWinActive(status: string | null | undefined): boolean {
  return status === 'ACTIVE';
}
