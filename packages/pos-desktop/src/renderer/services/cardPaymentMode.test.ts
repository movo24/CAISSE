import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveCardPaymentMode } from './cardPaymentMode';
import { toWirePayments } from './salePayload';

/**
 * Décision produit ratifiée (PR #25) : carte réelle via Stripe Terminal/WisePad 3 ;
 * mock strictement dev/test ; prod sans config = carte désactivée ; aucun paiement
 * carte fictif ne peut valider une vente réelle.
 */
describe('resolveCardPaymentMode', () => {
  it('backend configured → real, whatever the build', () => {
    expect(resolveCardPaymentMode({ stripeConfigured: true, isProdBuild: true })).toBe('real');
    expect(resolveCardPaymentMode({ stripeConfigured: true, isProdBuild: false })).toBe('real');
  });

  it('NOT configured + production build → card DISABLED (fail-closed)', () => {
    expect(resolveCardPaymentMode({ stripeConfigured: false, isProdBuild: true })).toBe('disabled');
  });

  it('NOT configured + dev build → labelled demo only', () => {
    expect(resolveCardPaymentMode({ stripeConfigured: false, isProdBuild: false })).toBe('demo');
  });
});

describe('toWirePayments — carries capture facts', () => {
  it('forwards pendingCapture + stripePaymentIntentId to the backend DTO shape', () => {
    const wire = toWirePayments([
      { method: 'card', amountMinorUnits: 1500, stripePaymentIntentId: 'pi_1', stripeReaderId: 'rd_1' },
      { method: 'card', amountMinorUnits: 500, pendingCapture: true },
    ]);
    expect(wire[0].stripePaymentIntentId).toBe('pi_1');
    expect(wire[0].pendingCapture).toBeUndefined();
    expect(wire[1].pendingCapture).toBe(true);
  });
});

/** Wiring invariants (source-level) on the card flow in usePayment. */
describe('usePayment — real card flow wiring (source)', () => {
  const src = readFileSync(join(__dirname, '..', 'hooks', 'usePayment.ts'), 'utf8');

  it('disabled mode never opens the TPE overlay — clear error instead', () => {
    expect(src).toMatch(/mode === 'disabled'[\s\S]{0,200}SALE_ERROR[\s\S]{0,100}CARD_DISABLED_MESSAGE[\s\S]{0,100}return;/);
  });

  it('a card leg can only be committed with capture facts (no facts → refused)', () => {
    expect(src).toMatch(/const facts = cardLegRef\.current;\s*\n\s*if \(!currentTpe \|\| !facts\)/);
    expect(src).toMatch(/setTpeResult\('refused'\)/);
  });

  it('real success carries the PaymentIntent id and is NOT pendingCapture', () => {
    expect(src).toMatch(/stripePaymentIntentId: paymentIntentId,[\s\S]{0,120}pendingCapture: false/);
  });

  it('demo success is flagged pendingCapture=true (sale lands payment_pending)', () => {
    expect(src).toMatch(/simulateDemoTpeSuccess[\s\S]{0,300}mode !== 'demo'\) return;[\s\S]{0,120}pendingCapture: true/);
  });

  it('the PaymentIntent is tied to the sale idempotency key (one checkout, one reference)', () => {
    expect(src).toMatch(/collectPayment\(amountMinor, saleIdemKeyRef\.current\)/);
  });

  it('cancel aborts an in-progress reader collection', () => {
    expect(src).toMatch(/isCollecting\) void stripeTerminal\.cancelCollect\(\)/);
  });
});

describe('useStripeTerminal — dev-only simulated readers (source)', () => {
  const src = readFileSync(join(__dirname, '..', 'hooks', 'useStripeTerminal.ts'), 'utf8');
  it('simulated discovery is gated on the Vite build flag, not process.env', () => {
    expect(src).toMatch(/simulated: !import\.meta\.env\.PROD/);
    expect(src).not.toMatch(/simulated: process\.env/);
  });
});
