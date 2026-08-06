// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  allocateTender,
  assertPaymentsApplied,
  computePaymentState,
} from './paymentMachine';
import { computeTicketVat } from './salePeripherals';

/**
 * DEUX MOTEURS D'ENCAISSEMENT → UN SEUL.
 *
 * `POSPage` (desktop) passait par `allocateTender` ; `usePayment` (chemin iPad)
 * envoyait le montant SAISI comme montant IMPUTÉ au ticket. Ticket 17,50 €,
 * caissier tape 20 € en espèces → 20,00 € imputés → 400 backend en ligne, et
 * HORS LIGNE : encaissé, imprimé, 2,50 € rendus, puis rejeté définitivement à
 * la synchronisation. Marchandise partie, zéro vente au journal fiscal.
 *
 * Ces tests portent sur le COMPORTEMENT (montants), pas sur la présence d'un
 * appel dans le source — c'est précisément la faiblesse qui avait laissé passer
 * le trou : une garde neutralisée gardait 30 tests au vert.
 */

describe('scénario terrain : 20 € tendus sur un ticket de 17,50 €', () => {
  const TICKET = 1750;

  it('l’appliqué est plafonné au reste dû, jamais le montant tendu', () => {
    const r = allocateTender(TICKET, 'cash', 2000);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.allocation.appliedMinorUnits).toBe(1750);
  });

  it('les espèces reçues restent distinctes de l’appliqué', () => {
    const r = allocateTender(TICKET, 'cash', 2000);
    if (!r.ok) throw new Error('unreachable');
    expect(r.allocation.cashReceivedMinorUnits).toBe(2000);
    expect(r.allocation.changeMinorUnits).toBe(250);
  });

  it('la garde comptable ACCEPTE l’appliqué et REFUSE le montant tendu', () => {
    // Ce qui part désormais au backend :
    expect(() => assertPaymentsApplied(TICKET, [{ method: 'cash', amountMinorUnits: 1750 }])).not.toThrow();
    // Ce qui partait avant le correctif :
    expect(() => assertPaymentsApplied(TICKET, [{ method: 'cash', amountMinorUnits: 2000 }])).toThrow();
  });

  it('le ticket est soldé exactement (aucun reste, aucun dépassement)', () => {
    const state = computePaymentState(TICKET, [{ method: 'cash', amountMinorUnits: 1750 }]);
    expect(state.isCovered).toBe(true);
    expect(state.remaining).toBe(0);
  });
});

describe('titre-resto / carte cadeau : dépassement REFUSÉ, jamais silencieux', () => {
  it('titre-resto de 10 € sur un ticket de 8,50 € est refusé avec un motif', () => {
    const r = allocateTender(850, 'voucher', 1000);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toMatch(/dépasse le reste dû/i);
  });

  it('carte cadeau exactement au reste dû → acceptée, aucune monnaie', () => {
    const r = allocateTender(1200, 'gift_card', 1200);
    if (!r.ok) throw new Error('unreachable');
    expect(r.allocation.appliedMinorUnits).toBe(1200);
    expect(r.allocation.changeMinorUnits).toBe(0);
  });

  it('avoir supérieur au reste dû → refusé (pas de monnaie sur un avoir)', () => {
    expect(allocateTender(500, 'store_credit', 900).ok).toBe(false);
  });
});

describe('paiement scindé : la somme des appliqués solde le ticket au centime', () => {
  it('3 € espèces puis 300 € tendus sur 6 € → 3 € appliqués, 297 € de monnaie', () => {
    const first = allocateTender(600, 'cash', 300);
    if (!first.ok) throw new Error('unreachable');
    expect(first.allocation.appliedMinorUnits).toBe(300);

    const second = allocateTender(300, 'cash', 30000);
    if (!second.ok) throw new Error('unreachable');
    expect(second.allocation.appliedMinorUnits).toBe(300);
    expect(second.allocation.changeMinorUnits).toBe(29700);

    // 303 € n'ont JAMAIS pu être imputés au ticket.
    expect(() =>
      assertPaymentsApplied(600, [
        { method: 'cash', amountMinorUnits: 300 },
        { method: 'cash', amountMinorUnits: 300 },
      ]),
    ).not.toThrow();
  });

  it('un ticket déjà soldé refuse tout tender supplémentaire', () => {
    expect(allocateTender(0, 'cash', 500).ok).toBe(false);
  });
});

describe('TVA du ticket imprimé avec remise GLOBALE', () => {
  const line = (ttc: number, rate: number) => ({
    quantity: 1,
    unitPriceMinorUnits: ttc,
    discountMinorUnits: 0,
    taxRate: rate,
  });

  it('100 € TTC remisés de 20 € → TVA 13,33 € (et non 16,67 €)', () => {
    const vat = computeTicketVat([line(10000, 20)], 2000);
    expect(vat).toHaveLength(1);
    expect(vat[0].ttc).toBeCloseTo(80, 2);
    expect(vat[0].tva).toBeCloseTo(13.33, 2);
    expect(vat[0].ht).toBeCloseTo(66.67, 2);
  });

  it('la ventilation solde le TOTAL du ticket (invariant fiscal)', () => {
    const items = [line(9000, 20), line(1000, 5.5)];
    const vat = computeTicketVat(items, 3000);
    const totalTtc = vat.reduce((s, r) => s + r.ttc, 0);
    expect(totalTtc).toBeCloseTo(70, 2); // 100 € − 30 € de remise
  });

  it('HT + TVA = TTC pour chaque taux, remise comprise', () => {
    for (const r of computeTicketVat([line(9000, 20), line(1000, 5.5)], 3000)) {
      expect(r.ht + r.tva).toBeCloseTo(r.ttc, 2);
    }
  });

  it('sans remise globale, le comportement d’origine est inchangé', () => {
    const vat = computeTicketVat([line(10000, 20)], 0);
    expect(vat[0].ttc).toBeCloseTo(100, 2);
    expect(vat[0].tva).toBeCloseTo(16.67, 2);
  });

  it('une remise supérieure au panier est bornée (jamais de TTC négatif)', () => {
    const vat = computeTicketVat([line(1000, 20)], 999999);
    expect(vat[0].ttc).toBe(0);
    expect(vat[0].tva).toBe(0);
  });

  it('aucune ligne ne devient négative : la dernière absorbe le reliquat', () => {
    const vat = computeTicketVat([line(9000, 20), line(1000, 20)], 9500);
    for (const r of vat) expect(r.ttc).toBeGreaterThanOrEqual(0);
    expect(vat.reduce((s, r) => s + r.ttc, 0)).toBeCloseTo(5, 2);
  });
});
