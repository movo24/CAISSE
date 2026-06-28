/**
 * POS-102 — Payments breakdown by method (pure, unit-testable).
 * Aggregates all payment legs across a set of sales into per-method totals,
 * for reconciliation / pre-accounting. Sorted by total desc.
 */
export interface PaymentLeg {
  method: string;
  amountMinorUnits: number;
}

export interface PaymentBreakdownRow {
  method: string;
  count: number;
  totalMinorUnits: number;
}

export function aggregatePaymentsByMethod(
  sales: { payments: PaymentLeg[] }[],
): PaymentBreakdownRow[] {
  const map = new Map<string, { count: number; total: number }>();
  for (const s of sales) {
    for (const p of s.payments ?? []) {
      const r = map.get(p.method) ?? { count: 0, total: 0 };
      r.count += 1;
      r.total += p.amountMinorUnits;
      map.set(p.method, r);
    }
  }
  return [...map.entries()]
    .map(([method, v]) => ({ method, count: v.count, totalMinorUnits: v.total }))
    .sort((a, b) => b.totalMinorUnits - a.totalMinorUnits);
}
