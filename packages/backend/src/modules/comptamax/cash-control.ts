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
 * `other`-bucket payments have no declared Z counterpart (declared = 0), so any
 * non-cash/non-card tender surfaces as a diff to investigate.
 */
export function reconcileCashControl(
  captured: readonly CapturedPayment[],
  declared: ZDeclared,
): CashControlResult {
  const sums: Record<TenderBucket, number> = { cash: 0, card: 0, other: 0 };
  for (const p of captured) {
    sums[tenderBucket(p.method)] += Number(p.amountMinorUnits) || 0;
  }

  const declaredByBucket: Record<TenderBucket, number> = {
    cash: declared.cashTotalMinorUnits || 0,
    card: declared.cardTotalMinorUnits || 0,
    other: 0,
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
