import { createHash } from 'crypto';

/**
 * POS-033/041/047 — Deterministic Stripe PaymentIntent idempotency key (pure, testable).
 * Extracted from StripeTerminalService.createPaymentIntent (behavior-preserving).
 *
 * Same (store, ticket, amount, currency, employee) → same key → Stripe reuses the same
 * PaymentIntent on a network retry (no double charge).
 */
export function paymentIntentIdempotencyKey(
  storeId: string,
  ticketNumber: string,
  amount: number,
  currency: string,
  employeeId?: string,
): string {
  return createHash('sha256')
    .update(`${storeId}:${ticketNumber}:${amount}:${currency}:${employeeId || ''}`)
    .digest('hex');
}
