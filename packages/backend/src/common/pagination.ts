/**
 * POS — Pagination param normalization (pure, unit-testable).
 * Consolidates the page/limit clamping duplicated across services
 * (products, returns, …): page ≥ 1, limit in [1, max].
 */

/** Clamp page to ≥ 1 (default 1). */
export function normalizePage(page?: number): number {
  return Math.max(page ?? 1, 1);
}

/** Clamp limit to [1, max] (default 50, max 100). */
export function normalizeLimit(limit?: number, def = 50, max = 100): number {
  return Math.min(Math.max(limit ?? def, 1), max);
}

/** Total page count for a result set (0 when limit ≤ 0, guarding division). */
export function totalPages(total: number, limit: number): number {
  return limit > 0 ? Math.ceil(total / limit) : 0;
}
