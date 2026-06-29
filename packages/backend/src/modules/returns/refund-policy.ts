/**
 * POS — Refund / credit-note state policy (pure, unit-testable).
 * Extracted from ReturnsService (behavior-preserving): allowed refund methods,
 * credit-note state derived from the refund method, and the spendable check.
 */

export const REFUND_METHODS = ['cash', 'card', 'store_credit'] as const;
export type RefundMethod = (typeof REFUND_METHODS)[number];

/** True when `m` is an accepted refund method. */
export function isValidRefundMethod(m: string): m is RefundMethod {
  return (REFUND_METHODS as readonly string[]).includes(m);
}

export interface CreditNoteRefundState {
  type: 'store_credit' | 'refund';
  refundMethod: RefundMethod | null;
  status: 'active' | 'refunded';
  remainingMinorUnits: number;
}

/**
 * Credit-note fields derived from the chosen refund method:
 * store_credit → a spendable balance (active, remaining = total);
 * cash/card    → an immediate refund (refunded, remaining = 0).
 */
export function creditNoteRefundState(
  refundMethod: RefundMethod,
  totalMinorUnits: number,
): CreditNoteRefundState {
  const isStoreCredit = refundMethod === 'store_credit';
  return {
    type: isStoreCredit ? 'store_credit' : 'refund',
    refundMethod: isStoreCredit ? null : refundMethod,
    status: isStoreCredit ? 'active' : 'refunded',
    remainingMinorUnits: isStoreCredit ? totalMinorUnits : 0,
  };
}

/** True when a store-credit avoir can still be spent as a tender. */
export function isSpendableStoreCredit(
  type: string,
  status: string,
  remainingMinorUnits: number,
): boolean {
  return (
    type === 'store_credit' &&
    (status === 'active' || status === 'partially_redeemed') &&
    remainingMinorUnits > 0
  );
}
