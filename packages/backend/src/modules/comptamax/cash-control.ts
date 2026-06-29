/**
 * POS-INT-110 — cash control / écart de caisse (pure, unit-testable).
 *
 * Cross-checks the frozen Z-report totals (`cash_session.closed`) against the
 * sum of the day's `payment.captured` events, by tender bucket (cash / card /
 * other). A non-zero diff is a real discrepancy to investigate — it never
 * mutates the Z-report (immutable) nor the sales; it is a read-only control.
 *
 * Pure: no DB, no Nest. Money is integer centimes.
 */

import { csvSafeRow } from '../../common/csv/csv-safe';

export interface CapturedPayment {
  method: string;
  amountMinorUnits: number;
}

export interface ZDeclared {
  cashTotalMinorUnits: number;
  cardTotalMinorUnits: number;
  totalRevenueMinorUnits?: number;
}

export type TenderBucket = 'cash' | 'card' | 'other';

export interface BucketControl {
  bucket: TenderBucket;
  capturedMinorUnits: number; // sum from payment.captured
  declaredMinorUnits: number; // from the Z-report
  diffMinorUnits: number; // captured − declared (0 = match)
}

export interface CashControlResult {
  byBucket: BucketControl[];
  totalCapturedMinorUnits: number;
  totalDeclaredMinorUnits: number;
  totalDiffMinorUnits: number;
  balanced: boolean; // every bucket diff === 0
}

/**
 * Cash-control CSV (accounting justificatif): one row per tender bucket plus a
 * TOTAL row. Stable header & column order; amounts in integer centimes.
 * Cells routed through the shared CSV-injection guard (POS-INT-113).
 */
export function cashControlToCsv(result: CashControlResult): string {
  const lines = [csvSafeRow(['bucket', 'capturedMinorUnits', 'declaredMinorUnits', 'diffMinorUnits'])];
  for (const b of result.byBucket) {
    lines.push(csvSafeRow([b.bucket, b.capturedMinorUnits, b.declaredMinorUnits, b.diffMinorUnits]));
  }
  lines.push(
    csvSafeRow([
      'TOTAL',
      result.totalCapturedMinorUnits,
      result.totalDeclaredMinorUnits,
      result.totalDiffMinorUnits,
    ]),
  );
  return lines.join('\n');
}

/** Map a POS payment method to the Z-report tender bucket. */
export function tenderBucket(method: string): TenderBucket {
  switch (method) {
    case 'cash':
      return 'cash';
    case 'card':
    case 'stripe_terminal':
      return 'card';
    default:
      return 'other';
  }
}

/**
 * Reconcile captured payments against the Z-report declared totals.
 * The `other` bucket is reconciled against the residual (totalRevenue − cash −
 * card) when totalRevenue is known, so a balanced day paid partly by store
 * credit / voucher does not false-flag; without totalRevenue, declared other = 0.
 */
export function reconcileCashControl(
  captured: readonly CapturedPayment[],
  declared: ZDeclared,
): CashControlResult {
  const sums: Record<TenderBucket, number> = { cash: 0, card: 0, other: 0 };
  for (const p of captured) {
    sums[tenderBucket(p.method)] += Number(p.amountMinorUnits) || 0;
  }

  const cashDeclared = declared.cashTotalMinorUnits || 0;
  const cardDeclared = declared.cardTotalMinorUnits || 0;
  // POS-INT-116 — the Z-report declares only cash & card explicitly. When the
  // total revenue is known, the "other" tenders (store_credit, voucher, mobile…)
  // are the residual = totalRevenue − cash − card; otherwise we cannot attribute
  // them, so declared other = 0 (and any captured other surfaces as a diff).
  const otherDeclared =
    typeof declared.totalRevenueMinorUnits === 'number'
      ? Math.max(0, declared.totalRevenueMinorUnits - cashDeclared - cardDeclared)
      : 0;

  const declaredByBucket: Record<TenderBucket, number> = {
    cash: cashDeclared,
    card: cardDeclared,
    other: otherDeclared,
  };

  const byBucket: BucketControl[] = (['cash', 'card', 'other'] as TenderBucket[]).map((bucket) => ({
    bucket,
    capturedMinorUnits: sums[bucket],
    declaredMinorUnits: declaredByBucket[bucket],
    diffMinorUnits: sums[bucket] - declaredByBucket[bucket],
  }));

  const totalCapturedMinorUnits = byBucket.reduce((s, b) => s + b.capturedMinorUnits, 0);
  const totalDeclaredMinorUnits = byBucket.reduce((s, b) => s + b.declaredMinorUnits, 0);

  return {
    byBucket,
    totalCapturedMinorUnits,
    totalDeclaredMinorUnits,
    totalDiffMinorUnits: totalCapturedMinorUnits - totalDeclaredMinorUnits,
    balanced: byBucket.every((b) => b.diffMinorUnits === 0),
  };
}
