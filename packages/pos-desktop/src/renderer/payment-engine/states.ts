/**
 * Payment Engine — canonical attempt statuses & transition rules (P0).
 *
 * Reference: docs/payment-engine.md §3.3 (architecture ratifiée owner 2026-07-14).
 * Pure module: no React, no I/O — exhaustively unit-tested.
 *
 * Hard rules enforced by the ENGINE (never by connectors):
 *  - TIMEOUT / COMMUNICATION_ERROR / UNKNOWN have exactly ONE exit:
 *    VERIFICATION_REQUIRED. Never back to a new collect() — zero structural
 *    double debit (règle owner suprême).
 *  - APPROVED is terminal for collection: only the REFUND_* path leaves it.
 *  - A sale cannot start a NEW attempt while another attempt of the same sale
 *    is still active (see isActiveStatus / canStartNewAttempt).
 */

export type PaymentAttemptStatus =
  | 'CREATED'
  | 'PAYMENT_PENDING'
  | 'WAITING_FOR_CUSTOMER'
  | 'WAITING_FOR_CARD'
  | 'AUTHORIZING'
  | 'APPROVED'
  | 'DECLINED'
  | 'CANCELLED'
  | 'COMMUNICATION_ERROR'
  | 'TIMEOUT'
  | 'UNKNOWN'
  | 'VERIFICATION_REQUIRED'
  | 'REFUND_PENDING'
  | 'REFUNDED'
  | 'REFUND_FAILED';

export const ALL_STATUSES: PaymentAttemptStatus[] = [
  'CREATED',
  'PAYMENT_PENDING',
  'WAITING_FOR_CUSTOMER',
  'WAITING_FOR_CARD',
  'AUTHORIZING',
  'APPROVED',
  'DECLINED',
  'CANCELLED',
  'COMMUNICATION_ERROR',
  'TIMEOUT',
  'UNKNOWN',
  'VERIFICATION_REQUIRED',
  'REFUND_PENDING',
  'REFUNDED',
  'REFUND_FAILED',
];

/**
 * Uncertain outcomes: the payment MAY have gone through. Their only legal exit
 * is VERIFICATION_REQUIRED (§3.3 — « transition unique possible »).
 */
export const UNCERTAIN_STATUSES: PaymentAttemptStatus[] = [
  'COMMUNICATION_ERROR',
  'TIMEOUT',
  'UNKNOWN',
];

/**
 * Statuses in which an attempt still holds the sale: while one attempt of a
 * sale is in any of these, NO new attempt may be started for that sale.
 * (VERIFICATION_REQUIRED included: unresolved doubt blocks any retry — §3.5.5.)
 */
export const ACTIVE_STATUSES: PaymentAttemptStatus[] = [
  'CREATED',
  'PAYMENT_PENDING',
  'WAITING_FOR_CUSTOMER',
  'WAITING_FOR_CARD',
  'AUTHORIZING',
  'COMMUNICATION_ERROR',
  'TIMEOUT',
  'UNKNOWN',
  'VERIFICATION_REQUIRED',
];

/** Adjacency map — the ONLY source of truth for allowed transitions. */
export const ALLOWED_TRANSITIONS: Record<PaymentAttemptStatus, PaymentAttemptStatus[]> = {
  CREATED: ['PAYMENT_PENDING', 'COMMUNICATION_ERROR', 'CANCELLED'],
  PAYMENT_PENDING: ['WAITING_FOR_CUSTOMER', 'CANCELLED', 'COMMUNICATION_ERROR'],
  WAITING_FOR_CUSTOMER: ['WAITING_FOR_CARD', 'CANCELLED', 'COMMUNICATION_ERROR', 'TIMEOUT'],
  WAITING_FOR_CARD: ['AUTHORIZING', 'CANCELLED', 'COMMUNICATION_ERROR', 'TIMEOUT'],
  AUTHORIZING: ['APPROVED', 'DECLINED', 'COMMUNICATION_ERROR', 'TIMEOUT', 'UNKNOWN'],
  // Uncertain trio: single exit — verification. NEVER a new collect.
  COMMUNICATION_ERROR: ['VERIFICATION_REQUIRED'],
  TIMEOUT: ['VERIFICATION_REQUIRED'],
  UNKNOWN: ['VERIFICATION_REQUIRED'],
  // Resolution after getStatus()/reconciliation (§3.3, §3.8).
  VERIFICATION_REQUIRED: ['APPROVED', 'DECLINED', 'CANCELLED'],
  // APPROVED is terminal for collection; only the refund path leaves it.
  APPROVED: ['REFUND_PENDING'],
  DECLINED: [],
  CANCELLED: [],
  REFUND_PENDING: ['REFUNDED', 'REFUND_FAILED'],
  REFUNDED: [],
  // A failed refund may be retried as a new referenced refund on the same
  // captured transaction (idempotent, D-PE3) — never a blind credit.
  REFUND_FAILED: ['REFUND_PENDING'],
};

export class InvalidPaymentTransitionError extends Error {
  readonly from: PaymentAttemptStatus;
  readonly to: PaymentAttemptStatus;

  constructor(from: PaymentAttemptStatus, to: PaymentAttemptStatus) {
    super(`Transition de paiement interdite : ${from} → ${to}`);
    this.name = 'InvalidPaymentTransitionError';
    this.from = from;
    this.to = to;
  }
}

export function canTransition(from: PaymentAttemptStatus, to: PaymentAttemptStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] || []).includes(to);
}

/** Returns `to` when legal; throws InvalidPaymentTransitionError otherwise. */
export function assertTransition(
  from: PaymentAttemptStatus,
  to: PaymentAttemptStatus,
): PaymentAttemptStatus {
  if (!canTransition(from, to)) throw new InvalidPaymentTransitionError(from, to);
  return to;
}

export function isUncertainStatus(s: PaymentAttemptStatus): boolean {
  return UNCERTAIN_STATUSES.includes(s);
}

export function isActiveStatus(s: PaymentAttemptStatus): boolean {
  return ACTIVE_STATUSES.includes(s);
}

/** No exit at all → fully terminal (DECLINED, CANCELLED, REFUNDED). */
export function isTerminalStatus(s: PaymentAttemptStatus): boolean {
  return (ALLOWED_TRANSITIONS[s] || []).length === 0;
}

/**
 * Engine-level guard (§3.5.2): a new attempt for a sale is allowed only when
 * NONE of its existing attempts is still active. An unresolved
 * VERIFICATION_REQUIRED therefore blocks any retry until a responsible party
 * resolves it (D-PE5).
 */
export function canStartNewAttempt(existingAttemptStatuses: PaymentAttemptStatus[]): boolean {
  return !existingAttemptStatuses.some(isActiveStatus);
}
