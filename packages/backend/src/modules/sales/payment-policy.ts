/**
 * POS-040/041/043/044/048 — Payment validation (pure, no DB/Nest → unit-testable).
 *
 * Extracted verbatim from SalesService.createSale (behavior-preserving): messages are
 * identical so the HTTP contract is unchanged when the caller maps the violation to a
 * BadRequestException.
 *
 * Rules:
 *  - Payments must COVER the total (≥). Overpayment is allowed ONLY in cash → `changeMinorUnits`.
 *  - A store_credit (avoir) can only cover the RESIDUAL due, never more (no value destruction):
 *    the server caps it regardless of the client-sent split.
 *  - Non-cash tenders (card, terminal, avoir, voucher…) must NOT exceed the total: there is no
 *    cash drawer change for a card overcharge (POS-INT-128 — prevents drawer-leak/fraud).
 *  All amounts are integer minor units (centimes).
 */

export type PaymentPolicyCode =
  | 'INSUFFICIENT_PAYMENT'
  | 'STORE_CREDIT_EXCEEDS_DUE'
  | 'NON_CASH_OVERPAYMENT';

export class PaymentPolicyViolation extends Error {
  constructor(public readonly code: PaymentPolicyCode, message: string) {
    super(message);
    this.name = 'PaymentPolicyViolation';
  }
}

export interface PaymentLine {
  method: string;
  amountMinorUnits: number;
}

export interface PaymentValidation {
  paymentTotal: number;
  storeCreditRequested: number;
  nonStoreCreditPaid: number;
  storeCreditAllowed: number;
  /** Overpayment to return to the customer (cash change). 0 when exact. */
  changeMinorUnits: number;
}

export function validatePayments(
  payments: PaymentLine[],
  totalAfterDiscount: number,
): PaymentValidation {
  const paymentTotal = payments.reduce((sum, p) => sum + p.amountMinorUnits, 0);
  if (paymentTotal < totalAfterDiscount) {
    throw new PaymentPolicyViolation(
      'INSUFFICIENT_PAYMENT',
      `Payment total ${paymentTotal} < sale total ${totalAfterDiscount}`,
    );
  }

  const storeCreditRequested = payments
    .filter((p) => p.method === 'store_credit')
    .reduce((sum, p) => sum + p.amountMinorUnits, 0);
  const nonStoreCreditPaid = paymentTotal - storeCreditRequested;
  const storeCreditAllowed = Math.max(0, totalAfterDiscount - nonStoreCreditPaid);
  if (storeCreditRequested > storeCreditAllowed) {
    throw new PaymentPolicyViolation(
      'STORE_CREDIT_EXCEEDS_DUE',
      `Montant d'avoir (${storeCreditRequested}) dépasse le reste dû (${storeCreditAllowed})`,
    );
  }

  // POS-INT-128 — only cash can overpay (→ cash change). Any non-cash tender total
  // above the sale total would imply giving cash drawer change for a card/avoir
  // overcharge, which is a leak/fraud vector. Reject it.
  const cashPaid = payments
    .filter((p) => p.method === 'cash')
    .reduce((sum, p) => sum + p.amountMinorUnits, 0);
  const nonCashPaid = paymentTotal - cashPaid;
  if (nonCashPaid > totalAfterDiscount) {
    throw new PaymentPolicyViolation(
      'NON_CASH_OVERPAYMENT',
      `Paiement non-espèces (${nonCashPaid}) supérieur au total ${totalAfterDiscount} — pas de rendu monnaie sur carte/avoir`,
    );
  }

  return {
    paymentTotal,
    storeCreditRequested,
    nonStoreCreditPaid,
    storeCreditAllowed,
    changeMinorUnits: paymentTotal - totalAfterDiscount,
  };
}
