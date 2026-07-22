import { describe, it, expect } from 'vitest';
import {
  ALL_STATUSES,
  ALLOWED_TRANSITIONS,
  UNCERTAIN_STATUSES,
  ACTIVE_STATUSES,
  canTransition,
  assertTransition,
  isUncertainStatus,
  isActiveStatus,
  isTerminalStatus,
  canStartNewAttempt,
  InvalidPaymentTransitionError,
  PaymentAttemptStatus,
} from './states';

/**
 * Independent copy of the ratified spec (docs/payment-engine.md §3.3) so the
 * implementation cannot drift silently: every one of the 15×15 pairs is
 * checked against THIS table, allowed and forbidden alike.
 */
const SPEC: Record<PaymentAttemptStatus, PaymentAttemptStatus[]> = {
  CREATED: ['PAYMENT_PENDING', 'COMMUNICATION_ERROR', 'CANCELLED'],
  PAYMENT_PENDING: ['WAITING_FOR_CUSTOMER', 'CANCELLED', 'COMMUNICATION_ERROR'],
  WAITING_FOR_CUSTOMER: ['WAITING_FOR_CARD', 'CANCELLED', 'COMMUNICATION_ERROR', 'TIMEOUT'],
  WAITING_FOR_CARD: ['AUTHORIZING', 'CANCELLED', 'COMMUNICATION_ERROR', 'TIMEOUT'],
  AUTHORIZING: ['APPROVED', 'DECLINED', 'COMMUNICATION_ERROR', 'TIMEOUT', 'UNKNOWN'],
  COMMUNICATION_ERROR: ['VERIFICATION_REQUIRED'],
  TIMEOUT: ['VERIFICATION_REQUIRED'],
  UNKNOWN: ['VERIFICATION_REQUIRED'],
  VERIFICATION_REQUIRED: ['APPROVED', 'DECLINED', 'CANCELLED'],
  APPROVED: ['REFUND_PENDING'],
  DECLINED: [],
  CANCELLED: [],
  REFUND_PENDING: ['REFUNDED', 'REFUND_FAILED'],
  REFUNDED: [],
  REFUND_FAILED: ['REFUND_PENDING'],
};

describe('canonical transition table — exhaustive (15×15)', () => {
  it('covers every status exactly once', () => {
    expect(new Set(ALL_STATUSES).size).toBe(15);
    expect(Object.keys(ALLOWED_TRANSITIONS).sort()).toEqual([...ALL_STATUSES].sort());
  });

  for (const from of ALL_STATUSES) {
    for (const to of ALL_STATUSES) {
      const allowed = SPEC[from].includes(to);
      it(`${from} → ${to} : ${allowed ? 'AUTORISÉE' : 'INTERDITE'}`, () => {
        expect(canTransition(from, to)).toBe(allowed);
        if (allowed) {
          expect(assertTransition(from, to)).toBe(to);
        } else {
          expect(() => assertTransition(from, to)).toThrow(InvalidPaymentTransitionError);
        }
      });
    }
  }
});

describe('règles dures (§3.3)', () => {
  it('TIMEOUT / COMMUNICATION_ERROR / UNKNOWN : sortie UNIQUE = VERIFICATION_REQUIRED', () => {
    for (const s of UNCERTAIN_STATUSES) {
      expect(ALLOWED_TRANSITIONS[s]).toEqual(['VERIFICATION_REQUIRED']);
      expect(isUncertainStatus(s)).toBe(true);
    }
  });

  it('UNKNOWN ne peut JAMAIS revenir vers un état de collecte (zéro double débit)', () => {
    for (const collectState of [
      'CREATED',
      'PAYMENT_PENDING',
      'WAITING_FOR_CUSTOMER',
      'WAITING_FOR_CARD',
      'AUTHORIZING',
    ] as PaymentAttemptStatus[]) {
      expect(canTransition('UNKNOWN', collectState)).toBe(false);
      expect(canTransition('TIMEOUT', collectState)).toBe(false);
      expect(canTransition('COMMUNICATION_ERROR', collectState)).toBe(false);
    }
  });

  it('APPROVED est terminal côté encaissement : seule sortie = REFUND_PENDING', () => {
    expect(ALLOWED_TRANSITIONS.APPROVED).toEqual(['REFUND_PENDING']);
  });

  it('DECLINED, CANCELLED, REFUNDED sont pleinement terminaux', () => {
    for (const s of ['DECLINED', 'CANCELLED', 'REFUNDED'] as PaymentAttemptStatus[]) {
      expect(isTerminalStatus(s)).toBe(true);
      expect(ALLOWED_TRANSITIONS[s]).toEqual([]);
    }
  });

  it('VERIFICATION_REQUIRED ne se résout que vers APPROVED / DECLINED / CANCELLED', () => {
    expect([...ALLOWED_TRANSITIONS.VERIFICATION_REQUIRED].sort()).toEqual(
      ['APPROVED', 'CANCELLED', 'DECLINED'].sort(),
    );
  });
});

describe('garde « une seule tentative active par vente » (§3.5.2)', () => {
  it('tous les états actifs bloquent une nouvelle tentative', () => {
    for (const s of ACTIVE_STATUSES) {
      expect(isActiveStatus(s)).toBe(true);
      expect(canStartNewAttempt([s])).toBe(false);
      // Même noyée au milieu d'états résolus, une tentative active bloque.
      expect(canStartNewAttempt(['DECLINED', s, 'CANCELLED'])).toBe(false);
    }
  });

  it('VERIFICATION_REQUIRED non résolue bloque toute relance (règle owner / D-PE5)', () => {
    expect(canStartNewAttempt(['VERIFICATION_REQUIRED'])).toBe(false);
  });

  it('états résolus uniquement → nouvelle tentative autorisée', () => {
    expect(canStartNewAttempt([])).toBe(true);
    expect(canStartNewAttempt(['DECLINED'])).toBe(true);
    expect(canStartNewAttempt(['CANCELLED', 'DECLINED'])).toBe(true);
  });

  it('APPROVED n\'est pas « actif » (la vente est payée, pas re-tentable) mais n\'est pas terminal', () => {
    expect(isActiveStatus('APPROVED')).toBe(false);
    expect(isTerminalStatus('APPROVED')).toBe(false);
  });

  it('les états de remboursement ne sont pas des états actifs d\'encaissement', () => {
    for (const s of ['REFUND_PENDING', 'REFUNDED', 'REFUND_FAILED'] as PaymentAttemptStatus[]) {
      expect(isActiveStatus(s)).toBe(false);
    }
  });
});
