/**
 * POS-040/041/043/044/048 — Payment validation (pure, no DB/Nest → unit-testable).
 *
 * Extracted verbatim from SalesService.createSale (behavior-preserving): messages are
 * identical so the HTTP contract is unchanged when the caller maps the violation to a
 * BadRequestException.
 *
 * Rules:
 *  - Payments must COVER the total (≥). Overpayment in cash is allowed → `changeMinorUnits`.
 *  - A store_credit (avoir) can only cover the RESIDUAL due, never more (no value destruction):
 *    the server caps it regardless of the client-sent split.
 *  All amounts are integer minor units (centimes).
 */

export type PaymentPolicyCode =
  | 'INSUFFICIENT_PAYMENT'
  | 'STORE_CREDIT_EXCEEDS_DUE';

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

  return {
    paymentTotal,
    storeCreditRequested,
    nonStoreCreditPaid,
    storeCreditAllowed,
    changeMinorUnits: paymentTotal - totalAfterDiscount,
  };
}
