/** P352 — POS-042 : moteur pur du paiement carte différé offline. */
import { describe, it, expect } from 'vitest';
import {
  canDeferCard,
  buildDeferredCaptureOrder,
  outstandingDeferred,
  settleDeferredCapture,
  DEFAULT_DEFERRED_GUARD,
} from './deferred-card-policy';

describe('canDeferCard — fenêtre exacte du différé', () => {
  it('refusé en ligne (carte directe) et refusé si TPE autonome (SIM/4G encaisse en direct)', () => {
    expect(canDeferCard('online', 'internet_dependent', 1000, 0).allowed).toBe(false);
    expect(canDeferCard('offline', 'autonomous', 1000, 0).allowed).toBe(false);
    expect(canDeferCard('offline', 'autonomous', 1000, 0).reason).toContain('autonome');
  });

  it('autorisé UNIQUEMENT offline + TPE dépendant Internet, sous plafonds', () => {
    expect(canDeferCard('offline', 'internet_dependent', 14999, 0).allowed).toBe(true);
    expect(canDeferCard('degraded', 'internet_dependent', 1000, 0).allowed).toBe(true);
  });

  it('plafond par ticket (150 €) et plafond d’encours (500 €) appliqués', () => {
    const perTicket = canDeferCard('offline', 'internet_dependent', 15001, 0);
    expect(perTicket.allowed).toBe(false);
    expect(perTicket.reason).toContain('plafond offline');

    // 490 € d'encours + 20 € demandés = 510 € > 500 €
    const outstanding = canDeferCard('offline', 'internet_dependent', 2000, 49000);
    expect(outstanding.allowed).toBe(false);
    expect(outstanding.reason).toContain('encours');

    // 480 € + 20 € = 500 € pile → passe
    expect(canDeferCard('offline', 'internet_dependent', 2000, 48000).allowed).toBe(true);
  });

  it('montant invalide (0, négatif, float) refusé', () => {
    for (const bad of [0, -5, 10.5]) {
      expect(canDeferCard('offline', 'internet_dependent', bad, 0).allowed).toBe(false);
    }
  });
});

describe('buildDeferredCaptureOrder — clé d’idempotence déterministe', () => {
  it('même vente + même montant ⇒ MÊME clé (rejeu de file sans double charge), ≤ 64 chars', () => {
    const a = buildDeferredCaptureOrder({ saleClientId: 'sale-abc', amountMinorUnits: 4200 });
    const b = buildDeferredCaptureOrder({ saleClientId: 'sale-abc', amountMinorUnits: 4200 });
    expect(a.idempotencyKey).toBe(b.idempotencyKey);
    expect(a.idempotencyKey.length).toBeLessThanOrEqual(64);
    // montant différent ⇒ clé différente (même clé + params différents = 409 côté serveur)
    const c = buildDeferredCaptureOrder({ saleClientId: 'sale-abc', amountMinorUnits: 4300 });
    expect(c.idempotencyKey).not.toBe(a.idempotencyKey);
  });

  it('refuse un ordre sans vente ou avec montant non entier', () => {
    expect(() => buildDeferredCaptureOrder({ saleClientId: '', amountMinorUnits: 100 })).toThrow();
    expect(() => buildDeferredCaptureOrder({ saleClientId: 's', amountMinorUnits: 9.99 })).toThrow();
  });
});

describe('outstandingDeferred — encours calculé sur la file', () => {
  it('somme les captures en attente/retry, ignore les synced et les autres types', () => {
    const queue = [
      { type: 'payment', status: 'local_pending', payload: { kind: 'card_deferred_capture', amountMinorUnits: 3000 } },
      { type: 'payment', status: 'failed', payload: { kind: 'card_deferred_capture', amountMinorUnits: 2000 } },
      { type: 'payment', status: 'synced', payload: { kind: 'card_deferred_capture', amountMinorUnits: 9999 } },
      { type: 'ticket', status: 'local_pending', payload: { kind: 'card_deferred_capture', amountMinorUnits: 500 } },
      { type: 'payment', status: 'local_pending', payload: { kind: 'autre', amountMinorUnits: 700 } },
    ];
    expect(outstandingDeferred(queue)).toBe(5000);
  });
});

describe('settleDeferredCapture — issue de capture au retour réseau', () => {
  it('captured → finaliser la vente (création idempotente), entrée synced', () => {
    const r = settleDeferredCapture('captured');
    expect(r.saleAction).toBe('finalize_sale');
    expect(r.queueStatus).toBe('synced');
  });

  it('declined → la vente en attente est ABANDONNÉE (jamais finalisée, rien dans la chaîne fiscale)', () => {
    const r = settleDeferredCapture('declined');
    expect(r.saleAction).toBe('void_pending_sale');
    expect(r.queueStatus).toBe('failed');
    expect(r.operatorMessage).toContain('REFUSÉE');
  });

  it('error → retry (vente toujours en attente), message opérateur non silencieux', () => {
    const r = settleDeferredCapture('error');
    expect(r.saleAction).toBe('keep_pending_retry');
    expect(r.queueStatus).toBe('local_pending');
    expect(r.operatorMessage.length).toBeGreaterThan(0);
  });
});

describe('cohérence NF525 de la stratégie', () => {
  it('aucun chemin ne finalise une vente sans capture réussie', () => {
    const outcomes = ['declined', 'error'] as const;
    for (const o of outcomes) {
      expect(settleDeferredCapture(o).saleAction).not.toBe('finalize_sale');
    }
  });

  it('les plafonds par défaut sont prudents (150 € ticket / 500 € encours)', () => {
    expect(DEFAULT_DEFERRED_GUARD.maxDeferredTicketMinorUnits).toBe(15000);
    expect(DEFAULT_DEFERRED_GUARD.maxDeferredOutstandingMinorUnits).toBe(50000);
  });
});
