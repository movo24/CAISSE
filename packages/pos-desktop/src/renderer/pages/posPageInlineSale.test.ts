import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * PR #26 — neutralisation du chemin de vente desktop inline dangereux
 * (décision produit ratifiée : pas de chemin de vente parallèle dangereux ;
 * plus jamais de faux ticket, de remise perdue ou de vente incohérente).
 * Invariants vérifiés au niveau source sur POSPage.tsx.
 */
const src = readFileSync(join(__dirname, 'POSPage.tsx'), 'utf8');

describe('POSPage inline — plus JAMAIS de faux ticket (P0 #2)', () => {
  it('the create catch no longer fabricates a T-###### ticket', () => {
    // The old dangerous pattern: catch { ticketNumber = `T-${Date.now()...}` }
    expect(src).not.toMatch(/catch\s*\{\s*\n?\s*ticketNumber = `T-\$\{Date\.now/);
  });

  it('network failure → honest OFF- ticket queued through the offline store', () => {
    expect(src).toMatch(/isNetworkError[\s\S]{0,400}OFF-\$\{Date\.now\(\)\.toString\(36\)/);
    expect(src).toMatch(/useOfflineStore\.getState\(\)/);
    expect(src).toMatch(/SALE_OFFLINE/);
  });

  it('non-network failure → error shown, cart KEPT, no confirmation (return)', () => {
    expect(src).toMatch(/setError\(message\);\s*\n\s*posEventBus\.emit\('SALE_ERROR', \{ message \}\);[\s\S]{0,200}return;/);
  });

  it('offline replay carries the same idempotency key as the failed online attempt', () => {
    expect(src).toMatch(/idempotencyKey,\s*\n\s*\},\s*\n\s*cashierId/);
  });
});

describe('POSPage inline — remises transmises (P0 #3)', () => {
  it('the create payload spreads toSaleDiscountFields (manual discount + promo)', () => {
    expect(src).toMatch(/\.\.\.toSaleDiscountFields\(store\),\s*\n\s*payments: toWirePayments\(payments\)/);
  });

  it('manual discount is pre-validated before the network (decision 5 mirror)', () => {
    expect(src).toMatch(/validateManualDiscount\(\{[\s\S]{0,200}manualDiscountMinor: store\.manualDiscountMinorUnits/);
  });
});

describe('POSPage inline — carte gated, jamais fictive (P0 #1)', () => {
  it('disabled mode (prod sans Stripe) → clear error, no overlay', () => {
    expect(src).toMatch(/mode === 'disabled'[\s\S]{0,120}setError\(CARD_DISABLED_MESSAGE\);\s*\n\s*return;/);
  });

  it('real mode → directed to the aligned iPad/WisePad 3 pipeline (no parallel reader flow)', () => {
    expect(src).toMatch(/mode === 'real'[\s\S]{0,300}iPad[\s\S]{0,100}return;/);
  });

  it('a card leg only commits with capture facts — no facts → refused', () => {
    expect(src).toMatch(/const facts = cardLegFactsRef\.current;\s*\n\s*if \(!currentTpe \|\| !facts\)/);
  });

  it('demo acceptance is explicit and flags pendingCapture=true (sale payment_pending)', () => {
    expect(src).toMatch(/simulateDemoTpeSuccess[\s\S]{0,300}mode !== 'demo'\) return;[\s\S]{0,120}pendingCapture: true/);
  });

  it('the demo overlay is labelled and success never reads as a real payment', () => {
    expect(src).toMatch(/MODE DÉMO — aucun paiement réel/);
    expect(src).toMatch(/Paiement simule \(DÉMO\) — a regulariser/);
  });
});
