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
export type PaymentMethod = 'cash' | 'card' | 'mixed' | 'voucher' | 'gift_card' | 'store_credit';

/** Tenders from which the customer can receive cash change back. */
export const CHANGE_ELIGIBLE_METHODS: PaymentMethod[] = ['cash'];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Espèces',
  card: 'Carte bancaire',
  mixed: 'Mixte',
  voucher: 'Titre-resto',
  gift_card: 'Carte cadeau',
  store_credit: 'Avoir',
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

/* ──────────────────────────────────────────────────────────────────────────
 * (H4) Sale-completion error policy — ONLINE-ONLY V1.
 *
 * The dangerous decision, extracted as a pure function so it is unit-testable
 * in the node env (no renderHook / testing-library needed). The hook calls
 * this and acts on the result.
 *
 * On a network error, the policy is REFUSE — never queue the sale offline:
 * the backend now rejects offline sales at sync (they would be lost), and
 * queuing + opening the drawer would take cash for a sale that never enters
 * the fiscal chain. A sale enters the chain ONLY when sealed server-side.
 * ────────────────────────────────────────────────────────────────────────── */

export type CompletionErrorAction =
  /** Network down → online-only V1: refuse, take no money, queue nothing. */
  | { kind: 'refuse_offline'; message: string }
  /** Backend reachable but rejected the sale (e.g. insufficient stock). */
  | { kind: 'surface_business_error' };

/** True when the error is a transport/network failure (no usable response). */
export function isNetworkError(err: any): boolean {
  return (
    !err?.response ||
    err?.code === 'ERR_NETWORK' ||
    err?.code === 'ECONNABORTED' ||
    (typeof err?.message === 'string' && err.message.includes('Network Error'))
  );
}

/**
 * Decide what the POS must do when sale completion throws. A network error
 * NEVER maps to an offline queue (that path is closed in V1) — it maps to a
 * refusal that moves no money. This is the regression guard: re-introducing
 * offline-queue-on-network would have to change this function and break its
 * test.
 */
export function decideCompletionError(err: any): CompletionErrorAction {
  if (isNetworkError(err)) {
    return {
      kind: 'refuse_offline',
      message:
        'Encaissement indisponible hors-ligne. La vente n’a PAS été ' +
        'enregistrée — réessayez quand la connexion revient.',
    };
  }
  return { kind: 'surface_business_error' };
}
