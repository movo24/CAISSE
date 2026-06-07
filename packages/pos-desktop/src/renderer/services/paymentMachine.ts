/**
 * Pure payment-tender state machine (no React, no I/O — unit-testable).
 *
 * Supported tenders. New no-PSP tenders:
 *   - 'voucher'   → titre-resto (meal voucher)
 *   - 'gift_card' → carte cadeau
 *
 * Business rule (French retail): cash change is given ONLY from cash. Overpayment
 * on any non-cash tender (card / meal voucher / gift card) is NOT returned as
 * cash — meal-voucher excess in particular is forfeited by law.
 */
export type PaymentMethod = 'cash' | 'card' | 'mixed' | 'voucher' | 'gift_card';

/** Tenders from which the customer can receive cash change back. */
export const CHANGE_ELIGIBLE_METHODS: PaymentMethod[] = ['cash'];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Espèces',
  card: 'Carte bancaire',
  mixed: 'Mixte',
  voucher: 'Titre-resto',
  gift_card: 'Carte cadeau',
};

export interface Tender {
  method: PaymentMethod;
  amountMinorUnits: number;
}

export interface PaymentState {
  /** Sum of all tender amounts. */
  totalPaid: number;
  /** Amount still owed: max(0, total - totalPaid). */
  remaining: number;
  /** Cash change to give back (only ever drawn from cash tenders). */
  changeDue: number;
  /** Non-cash amount paid beyond the total — forfeited (no change on voucher/card/gift). */
  forfeitedOverpay: number;
  /** True once tenders cover the total. */
  isCovered: boolean;
}

const sum = (tenders: Tender[], pred: (t: Tender) => boolean): number =>
  tenders.filter(pred).reduce((s, t) => s + Math.max(0, t.amountMinorUnits || 0), 0);

export function computePaymentState(totalMinorUnits: number, tenders: Tender[]): PaymentState {
  const total = Math.max(0, totalMinorUnits || 0);
  const cashPaid = sum(tenders, (t) => CHANGE_ELIGIBLE_METHODS.includes(t.method));
  const nonCashPaid = sum(tenders, (t) => !CHANGE_ELIGIBLE_METHODS.includes(t.method));
  const totalPaid = cashPaid + nonCashPaid;

  // Cash only fills what non-cash tenders did not cover; any extra cash is change.
  const cashNeeded = Math.max(0, total - nonCashPaid);
  const changeDue = Math.max(0, cashPaid - cashNeeded);
  // Non-cash beyond the total cannot become change → forfeited.
  const forfeitedOverpay = Math.max(0, nonCashPaid - total);

  return {
    totalPaid,
    remaining: Math.max(0, total - totalPaid),
    changeDue,
    forfeitedOverpay,
    isCovered: totalPaid >= total,
  };
}

/** Does the running tender list cover the ticket total? */
export function isFullyCovered(totalMinorUnits: number, tenders: Tender[]): boolean {
  return computePaymentState(totalMinorUnits, tenders).isCovered;
}
