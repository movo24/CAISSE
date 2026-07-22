import { describe, it, expect } from 'vitest';
import {
  fromTpeResult,
  fromTerminalStatus,
  providerForCardMode,
  outcomeToStatus,
  fromStripePaymentIntentStatus,
  STATUS_MESSAGES_FR,
} from './mapping';
import { ALL_STATUSES, canTransition } from './states';
import { newPaymentIdentifiers, newAttemptForPayment, attemptIdempotencyKey, refundIdempotencyKey } from './identifiers';

describe('mapping des états legacy → canon', () => {
  it('tpeResult (usePayment / POSPage)', () => {
    expect(fromTpeResult('success')).toBe('APPROVED');
    expect(fromTpeResult('refused')).toBe('DECLINED');
    expect(fromTpeResult('timeout')).toBe('TIMEOUT');
  });

  it('TerminalStatus (useStripeTerminal)', () => {
    expect(fromTerminalStatus('collecting')).toBe('WAITING_FOR_CARD');
    expect(fromTerminalStatus('error')).toBe('COMMUNICATION_ERROR');
    for (const s of ['idle', 'loading', 'discovering', 'connecting', 'connected'] as const) {
      expect(fromTerminalStatus(s)).toBe('PAYMENT_PENDING');
    }
  });

  it('CardPaymentMode → provider (disabled = aucun flux)', () => {
    expect(providerForCardMode('real')).toBe('stripe');
    expect(providerForCardMode('demo')).toBe('mock');
    expect(providerForCardMode('disabled')).toBeNull();
  });

  it('outcome provider → statut canonique (bijection totale)', () => {
    expect(outcomeToStatus('approved')).toBe('APPROVED');
    expect(outcomeToStatus('declined')).toBe('DECLINED');
    expect(outcomeToStatus('cancelled')).toBe('CANCELLED');
    expect(outcomeToStatus('timeout')).toBe('TIMEOUT');
    expect(outcomeToStatus('communication_error')).toBe('COMMUNICATION_ERROR');
    expect(outcomeToStatus('unknown')).toBe('UNKNOWN');
  });
});

describe('mapping Stripe PaymentIntent → outcome (aligné verifyCardCaptureClaims)', () => {
  it("seul 'succeeded' est un succès", () => {
    expect(fromStripePaymentIntentStatus('succeeded')).toBe('approved');
  });

  it("'canceled' est une annulation", () => {
    expect(fromStripePaymentIntentStatus('canceled')).toBe('cancelled');
  });

  it('tout état en cours ou inconnu est UNKNOWN — jamais un succès implicite', () => {
    for (const s of [
      'requires_payment_method',
      'requires_confirmation',
      'requires_action',
      'requires_capture',
      'processing',
      'nonsense_future_status',
      '',
    ]) {
      expect(fromStripePaymentIntentStatus(s)).toBe('unknown');
    }
  });

  it('un résultat unknown mappe vers un statut dont la seule sortie est la vérification', () => {
    const status = outcomeToStatus(fromStripePaymentIntentStatus('processing'));
    expect(status).toBe('UNKNOWN');
    expect(canTransition(status, 'VERIFICATION_REQUIRED')).toBe(true);
    expect(canTransition(status, 'APPROVED')).toBe(false);
  });
});

describe('UX §3.11 — messages caissier', () => {
  it('chaque statut canonique a un message FR, sans nom de fournisseur', () => {
    for (const s of ALL_STATUSES) {
      const msg = STATUS_MESSAGES_FR[s];
      expect(msg).toBeTruthy();
      expect(msg.toLowerCase()).not.toMatch(/stripe|cic|monetico|adyen|worldline|wisepad/);
    }
  });
});

describe('identifiants §3.5 — générés par le moteur, déterministes', () => {
  it('newPaymentIdentifiers : uuids distincts + clé dérivée déterministe', () => {
    const a = newPaymentIdentifiers();
    const b = newPaymentIdentifiers();
    expect(a.globalPaymentId).not.toBe(b.globalPaymentId);
    expect(a.attemptId).not.toBe(b.attemptId);
    expect(a.idempotencyKey).toBe(attemptIdempotencyKey(a.attemptId));
    expect(a.idempotencyKey).toBe(`pay_${a.attemptId}`);
  });

  it('la clé d\'idempotence est stable pour un même attempt (retry technique)', () => {
    const { attemptId } = newPaymentIdentifiers();
    expect(attemptIdempotencyKey(attemptId)).toBe(attemptIdempotencyKey(attemptId));
    expect(refundIdempotencyKey(attemptId)).toBe(refundIdempotencyKey(attemptId));
    expect(refundIdempotencyKey(attemptId)).not.toBe(attemptIdempotencyKey(attemptId));
  });

  it('nouvelle tentative d\'un même paiement : même GlobalPaymentId, attempt et clé neufs', () => {
    const first = newPaymentIdentifiers();
    const retry = newAttemptForPayment(first.globalPaymentId);
    expect(retry.globalPaymentId).toBe(first.globalPaymentId);
    expect(retry.attemptId).not.toBe(first.attemptId);
    expect(retry.idempotencyKey).not.toBe(first.idempotencyKey);
  });
});
