/**
 * POS-FE-167 — shared severity ordering for supervision/stock lists.
 * Ranks statuses so the most urgent rows surface first. Pure & unit-testable.
 */
export type StockStatus = 'ok' | 'low' | 'depleted';

const STOCK_RANK: Record<StockStatus, number> = { depleted: 2, low: 1, ok: 0 };

/** Higher = more urgent. Unknown status → 0 (treated as ok). */
export function stockSeverityRank(status: string | null | undefined): number {
  return STOCK_RANK[(status as StockStatus)] ?? 0;
}

/** Sort a copy of rows by stock severity (depleted → low → ok), stable on input order. */
export function sortByStockSeverity<T extends { status?: string | null }>(rows: readonly T[]): T[] {
  return [...(rows ?? [])].sort((a, b) => stockSeverityRank(b.status) - stockSeverityRank(a.status));
}

/** Keep only rows that represent a discrepancy (qtyDiff !== 0). */
export function onlyDiscrepancies<T extends { qtyDiff: number }>(rows: readonly T[]): T[] {
  return (rows ?? []).filter((r) => r.qtyDiff !== 0);
}
