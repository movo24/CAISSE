/**
 * P322 (cycle I5) — pure presentation helpers for the stock reconciliation
 * screen (GET /api/stock/reconcile). Kept out of the component so the display
 * rules are unit-testable.
 */

export interface ReconRow {
  productId: string;
  productName: string;
  counter: number;
  journalNet: number | null;
  balance: number | null;
  balanceDrift: number | null;
}

export type DriftLevel = 'ok' | 'drift' | 'no-balance';

/** Display classification of one row. */
export function driftLevel(row: ReconRow): DriftLevel {
  if (row.balance === null) return 'no-balance';
  return row.balanceDrift === 0 ? 'ok' : 'drift';
}

/** Sort: drifting rows first (biggest absolute drift), then no-balance, then ok. */
export function sortForDisplay(rows: ReconRow[]): ReconRow[] {
  const rank = (r: ReconRow) => (driftLevel(r) === 'drift' ? 0 : driftLevel(r) === 'no-balance' ? 1 : 2);
  return [...rows].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    const byDrift = Math.abs(b.balanceDrift ?? 0) - Math.abs(a.balanceDrift ?? 0);
    if (byDrift !== 0) return byDrift;
    return a.productName.localeCompare(b.productName);
  });
}

/** Human summary line. */
export function reconSummary(rows: ReconRow[], driftCount: number): string {
  if (rows.length === 0) return 'Aucun produit actif.';
  if (driftCount === 0) return `${rows.length} produits — aucune dérive balance/compteur.`;
  return `${rows.length} produits — ${driftCount} en dérive (balance legacy ≠ compteur).`;
}
