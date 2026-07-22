/**
 * Payment Engine — mapping of EXISTING states to the canonical model (P0).
 *
 * docs/payment-engine.md P0: « mapping des états existants → canoniques ».
 * Three legacy mini-machines exist today (écart §2.3.10):
 *   - tpeResult ('success' | 'refused' | 'timeout') — usePayment / POSPage
 *   - TerminalStatus ('idle' | … | 'collecting' | 'error') — useStripeTerminal
 *   - CardPaymentMode ('real' | 'demo' | 'disabled') — cardPaymentMode.ts
 * Plus the Stripe PaymentIntent statuses verified server-side.
 *
 * Pure functions — connectors map THEIR states to the canon, never the reverse
 * (checklist §7.3).
 */

import type { PaymentAttemptStatus } from './states';
import type { ProviderOutcome } from './types';

/** Legacy overlay result (usePayment.tpeResult / POSPage) → canonical status. */
export function fromTpeResult(result: 'success' | 'refused' | 'timeout'): PaymentAttemptStatus {
  switch (result) {
    case 'success':
      return 'APPROVED';
    case 'refused':
      return 'DECLINED';
    case 'timeout':
      return 'TIMEOUT';
  }
}

/** Legacy useStripeTerminal TerminalStatus → canonical status of a live attempt. */
export function fromTerminalStatus(
  status: 'idle' | 'loading' | 'discovering' | 'connecting' | 'connected' | 'collecting' | 'error',
): PaymentAttemptStatus {
  switch (status) {
    case 'collecting':
      return 'WAITING_FOR_CARD';
    case 'error':
      return 'COMMUNICATION_ERROR';
    // Pre-payment lifecycle states: the attempt (if any) is still pending.
    case 'idle':
    case 'loading':
    case 'discovering':
    case 'connecting':
    case 'connected':
      return 'PAYMENT_PENDING';
  }
}

/**
 * Legacy CardPaymentMode → provider name (§3.7 modes de fonctionnement).
 * 'disabled' has no provider: card is fail-closed, no attempt may start.
 */
export function providerForCardMode(mode: 'real' | 'demo' | 'disabled'): string | null {
  switch (mode) {
    case 'real':
      return 'stripe';
    case 'demo':
      return 'mock';
    case 'disabled':
      return null;
  }
}

/** Canonical provider outcome → canonical attempt status. */
export function outcomeToStatus(outcome: ProviderOutcome): PaymentAttemptStatus {
  switch (outcome) {
    case 'approved':
      return 'APPROVED';
    case 'declined':
      return 'DECLINED';
    case 'cancelled':
      return 'CANCELLED';
    case 'timeout':
      return 'TIMEOUT';
    case 'communication_error':
      return 'COMMUNICATION_ERROR';
    case 'unknown':
      return 'UNKNOWN';
  }
}

/**
 * Stripe PaymentIntent status → canonical provider outcome, aligned with the
 * server-side capture matrix (sales.service.ts verifyCardCaptureClaims):
 * only 'succeeded' is approved; 'canceled' is cancelled; anything still in
 * flight or unexpected is NOT a success.
 */
export function fromStripePaymentIntentStatus(status: string): ProviderOutcome {
  switch (status) {
    case 'succeeded':
      return 'approved';
    case 'canceled':
      return 'cancelled';
    case 'requires_payment_method':
    case 'requires_confirmation':
    case 'requires_action':
    case 'requires_capture':
    case 'processing':
      return 'unknown';
    default:
      return 'unknown';
  }
}

/**
 * UX caissier §3.11 — one message table for EVERY provider. The provider name
 * never appears in the checkout journey.
 */
export const STATUS_MESSAGES_FR: Record<PaymentAttemptStatus, string> = {
  CREATED: 'Paiement par carte',
  PAYMENT_PENDING: 'Paiement par carte',
  WAITING_FOR_CUSTOMER: 'Présentez votre carte',
  WAITING_FOR_CARD: 'Présentez votre carte',
  AUTHORIZING: 'Paiement en cours',
  APPROVED: 'Paiement accepté',
  DECLINED: 'Paiement refusé',
  CANCELLED: 'Paiement annulé',
  COMMUNICATION_ERROR: 'Communication perdue',
  TIMEOUT: 'Communication perdue',
  UNKNOWN: 'Vérification nécessaire',
  VERIFICATION_REQUIRED: 'Vérification nécessaire',
  REFUND_PENDING: 'Remboursement en cours',
  REFUNDED: 'Remboursement effectué',
  REFUND_FAILED: 'Remboursement échoué',
};
