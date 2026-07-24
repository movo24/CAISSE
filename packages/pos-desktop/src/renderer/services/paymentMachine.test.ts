import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { computePaymentState, isFullyCovered, Tender } from './paymentMachine';

const t = (method: any, amount: number): Tender => ({ method, amountMinorUnits: amount });

describe('computePaymentState', () => {
  it('cash exact → covered, no change', () => {
    const s = computePaymentState(1000, [t('cash', 1000)]);
    expect(s).toEqual({ totalPaid: 1000, remaining: 0, changeDue: 0, forfeitedOverpay: 0, isCovered: true });
  });

  it('cash overpay → change from cash', () => {
    const s = computePaymentState(1000, [t('cash', 1500)]);
    expect(s.isCovered).toBe(true);
    expect(s.changeDue).toBe(500);
    expect(s.forfeitedOverpay).toBe(0);
  });

  it('card exact → covered, no change', () => {
    const s = computePaymentState(1000, [t('card', 1000)]);
    expect(s.changeDue).toBe(0);
    expect(s.isCovered).toBe(true);
  });

  it('under-payment → not covered, remaining owed', () => {
    const s = computePaymentState(1000, [t('cash', 400)]);
    expect(s.isCovered).toBe(false);
    expect(s.remaining).toBe(600);
    expect(s.changeDue).toBe(0);
  });

  it('meal voucher overpay → covered but NO cash change (excess forfeited)', () => {
    const s = computePaymentState(1000, [t('voucher', 1200)]);
    expect(s.isCovered).toBe(true);
    expect(s.changeDue).toBe(0);
    expect(s.forfeitedOverpay).toBe(200);
  });

  it('gift card overpay → no change either (non-cash)', () => {
    const s = computePaymentState(1000, [t('gift_card', 1300)]);
    expect(s.changeDue).toBe(0);
    expect(s.forfeitedOverpay).toBe(300);
  });

  it('voucher + cash: change comes only from the cash part', () => {
    // 7€ voucher + 5€ cash on a 10€ ticket → cash needed = 3€ → change = 2€
    const s = computePaymentState(1000, [t('voucher', 700), t('cash', 500)]);
    expect(s.isCovered).toBe(true);
    expect(s.changeDue).toBe(200);
    expect(s.forfeitedOverpay).toBe(0);
  });

  it('voucher covers more than total + cash added: cash is fully change, voucher excess forfeited', () => {
    // 12€ voucher + 3€ cash on 10€ → non-cash already covers; all 3€ cash is change; 2€ voucher forfeited
    const s = computePaymentState(1000, [t('voucher', 1200), t('cash', 300)]);
    expect(s.isCovered).toBe(true);
    expect(s.changeDue).toBe(300);
    expect(s.forfeitedOverpay).toBe(200);
  });

  it('isFullyCovered reflects coverage', () => {
    expect(isFullyCovered(1000, [t('cash', 1000)])).toBe(true);
    expect(isFullyCovered(1000, [t('cash', 999)])).toBe(false);
  });
});

/* ═══ P0 financier 2026-07-24 — allocation séparée (appliqué / reçu / monnaie) ═══ */
import { allocateTender, evaluateChangeApproval, DEFAULT_CHANGE_POLICY } from './paymentMachine';

describe('allocateTender — le montant appliqué ne dépasse JAMAIS le reste dû', () => {
  it('cas owner 1 : ticket 6€, cash 3€ puis 3€ → chaque appliqué = 3€, aucun débordement', () => {
    const a1 = allocateTender(600, 'cash', 300);
    expect(a1).toEqual({ ok: true, allocation: { method: 'cash', appliedMinorUnits: 300, cashReceivedMinorUnits: 300, changeMinorUnits: 0 } });
    const a2 = allocateTender(300, 'cash', 300);
    expect(a2.ok && a2.allocation.appliedMinorUnits).toBe(300);
    expect(a2.ok && a2.allocation.changeMinorUnits).toBe(0);
  });

  it('cas owner 2 : reste 3€, cash REÇU 300€ → appliqué plafonné à 3€, monnaie 297€ (jamais 303€ encaissés)', () => {
    const a = allocateTender(300, 'cash', 30000);
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(a.allocation.appliedMinorUnits).toBe(300);       // net imputé au ticket
      expect(a.allocation.cashReceivedMinorUnits).toBe(30000); // espèces reçues (mouvement distinct)
      expect(a.allocation.changeMinorUnits).toBe(29700);       // monnaie = reçu − appliqué
    }
  });

  it('cas owner 3 : reste 3€, espèces reçues 5€ → appliqué 3€, monnaie 2€', () => {
    const a = allocateTender(300, 'cash', 500);
    expect(a.ok && a.allocation).toMatchObject({ appliedMinorUnits: 300, cashReceivedMinorUnits: 500, changeMinorUnits: 200 });
  });

  it('cas owner 4 : carte / titre-resto / carte cadeau / avoir > reste dû → REFUSÉ (aucun dépassement)', () => {
    for (const m of ['card', 'voucher', 'gift_card', 'store_credit'] as const) {
      const a = allocateTender(300, m, 500);
      expect(a.ok).toBe(false);
      if (!a.ok) expect(a.reason).toMatch(/dépasse le reste dû/);
    }
  });

  it('non-espèces exactement au reste dû → accepté, aucune monnaie', () => {
    const a = allocateTender(300, 'card', 300);
    expect(a.ok && a.allocation).toMatchObject({ appliedMinorUnits: 300, changeMinorUnits: 0 });
  });

  it('cas owner 5 : reste ≤ 0 (ticket déjà soldé) → refusé (jamais de reste négatif)', () => {
    expect(allocateTender(0, 'cash', 100).ok).toBe(false);
    expect(allocateTender(-50, 'card', 100).ok).toBe(false);
  });

  it('montant invalide (0, négatif, NaN) → refusé', () => {
    expect(allocateTender(600, 'cash', 0).ok).toBe(false);
    expect(allocateTender(600, 'cash', -100).ok).toBe(false);
    expect(allocateTender(600, 'cash', NaN).ok).toBe(false);
  });

  it('somme des appliqués = total exact (6€), jamais 303€', () => {
    const a1 = allocateTender(600, 'cash', 300);
    const a2 = allocateTender(300, 'cash', 30000);
    const netApplied = (a1.ok ? a1.allocation.appliedMinorUnits : 0) + (a2.ok ? a2.allocation.appliedMinorUnits : 0);
    expect(netApplied).toBe(600); // net encaissé pour le ticket = 6,00 € EXACT
  });
});

describe('evaluateChangeApproval — monnaie aberrante bloquée ou soumise au manager', () => {
  it('cas owner : 297€ de monnaie (300 reçus / 3 dus) → JAMAIS accepté en silence (manager ou block)', () => {
    const d = evaluateChangeApproval(29700, DEFAULT_CHANGE_POLICY);
    expect(d.decision === 'manager' || d.decision === 'block').toBe(true);
  });

  it('petite monnaie (2€) → ok', () => {
    expect(evaluateChangeApproval(200, DEFAULT_CHANGE_POLICY).decision).toBe('ok');
  });

  it('monnaie ≥ seuil manager (50€) → manager', () => {
    expect(evaluateChangeApproval(6000, { managerThresholdMinorUnits: 5000 }).decision).toBe('manager');
  });

  it('liquidités insuffisantes pour rendre → block', () => {
    const d = evaluateChangeApproval(10000, { managerThresholdMinorUnits: 5000, drawerCashMinorUnits: 3000 });
    expect(d.decision).toBe('block');
    expect(d.reason).toMatch(/[Ll]iquidit/);
  });

  it('aucune monnaie (≤ 0) → ok', () => {
    expect(evaluateChangeApproval(0, DEFAULT_CHANGE_POLICY).decision).toBe('ok');
    expect(evaluateChangeApproval(-100, DEFAULT_CHANGE_POLICY).decision).toBe('ok');
  });
});

import { assertPaymentsApplied } from './paymentMachine';

describe('assertPaymentsApplied — garde comptable (couche store local)', () => {
  it('somme des appliqués == total → OK', () => {
    expect(() => assertPaymentsApplied(600, [{ method: 'cash', amountMinorUnits: 300 }, { method: 'cash', amountMinorUnits: 300 }])).not.toThrow();
  });
  it('sur-paiement appliqué (303€ pour 6€) → LÈVE (jamais envoyé au backend)', () => {
    expect(() => assertPaymentsApplied(600, [{ method: 'cash', amountMinorUnits: 300 }, { method: 'cash', amountMinorUnits: 30000 }])).toThrow(/dépasser le total|≠ total/);
  });
  it('sous-paiement → LÈVE', () => {
    expect(() => assertPaymentsApplied(600, [{ method: 'cash', amountMinorUnits: 300 }])).toThrow();
  });
  it('montant appliqué invalide (0/négatif) → LÈVE', () => {
    expect(() => assertPaymentsApplied(600, [{ method: 'cash', amountMinorUnits: 0 }, { method: 'cash', amountMinorUnits: 600 }])).toThrow(/invalide/);
  });
});

describe('POSPage — câblage des gardes de paiement (source)', () => {
  const src = readFileSync(join(__dirname, '..', 'pages', 'POSPage.tsx'), 'utf8');
  it('utilise allocateTender pour plafonner (jamais le montant brut)', () => {
    expect(src).toMatch(/allocateTender\(remaining, method/);
  });
  it('évalue la monnaie (evaluateChangeApproval) avant de finaliser', () => {
    expect(src).toMatch(/evaluateChangeApproval\(changeSum/);
  });
  it('garde comptable assertPaymentsApplied dans finalizePayment', () => {
    expect(src).toMatch(/assertPaymentsApplied\(store\.total\(\), payments\)/);
  });
  it('garde session NON OUVERTE avant encaissement', () => {
    expect(src).toMatch(/posSessionOpenFailed && !store\.posSession\?\.id/);
  });
});
