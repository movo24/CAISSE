import {
  buildSaleJournalLines,
  buildRefundJournalLines,
  journalIsBalanced,
  journalTotals,
  aggregateJournalByAccount,
  journalToCsv,
  paymentAccount,
  ACCOUNTS,
} from './pre-accounting';

describe('Comptamax pre-accounting engine', () => {
  describe('paymentAccount', () => {
    it('maps methods to accounts', () => {
      expect(paymentAccount('cash')).toBe(ACCOUNTS.CAISSE_ESPECES);
      expect(paymentAccount('card')).toBe(ACCOUNTS.BANQUE_CARTE);
      expect(paymentAccount('stripe_terminal')).toBe(ACCOUNTS.BANQUE_CARTE);
      expect(paymentAccount('store_credit')).toBe(ACCOUNTS.AVOIR_CLIENT);
      expect(paymentAccount('bitcoin')).toBe(ACCOUNTS.ATTENTE);
    });
  });

  describe('buildSaleJournalLines', () => {
    const lines = buildSaleJournalLines({
      ticketNumber: 'T-1',
      totalMinorUnits: 12000, // TTC
      taxTotalMinorUnits: 2000,
      payments: [
        { method: 'card', amountMinorUnits: 10000 },
        { method: 'cash', amountMinorUnits: 2000 },
      ],
    });

    it('is balanced (Σ débit === Σ crédit === TTC)', () => {
      expect(journalIsBalanced(lines)).toBe(true);
      expect(journalTotals(lines)).toEqual({ debit: 12000, credit: 12000 });
    });
    it('credits HT (707) and TVA (44571)', () => {
      const ht = lines.find((l) => l.account === ACCOUNTS.VENTE_HT)!;
      const tva = lines.find((l) => l.account === ACCOUNTS.TVA_COLLECTEE)!;
      expect(ht.creditMinorUnits).toBe(10000);
      expect(tva.creditMinorUnits).toBe(2000);
    });
    it('debits encaissements per payment method', () => {
      const card = lines.find((l) => l.account === ACCOUNTS.BANQUE_CARTE)!;
      const cash = lines.find((l) => l.account === ACCOUNTS.CAISSE_ESPECES)!;
      expect(card.debitMinorUnits).toBe(10000);
      expect(cash.debitMinorUnits).toBe(2000);
    });
    it('skips zero-amount payments and omits TVA line when tax is 0', () => {
      const l2 = buildSaleJournalLines({
        ticketNumber: 'T-2', totalMinorUnits: 500, taxTotalMinorUnits: 0,
        payments: [{ method: 'cash', amountMinorUnits: 500 }, { method: 'card', amountMinorUnits: 0 }],
      });
      expect(l2.some((l) => l.account === ACCOUNTS.TVA_COLLECTEE)).toBe(false);
      expect(l2.filter((l) => l.debitMinorUnits > 0)).toHaveLength(1);
      expect(journalIsBalanced(l2)).toBe(true);
    });
  });

  describe('buildRefundJournalLines', () => {
    it('store_credit refund balances, credits the avoir account', () => {
      const lines = buildRefundJournalLines({
        code: 'AV-1', totalMinorUnits: 1200, taxTotalMinorUnits: 200, type: 'store_credit', refundMethod: null,
      });
      expect(journalIsBalanced(lines)).toBe(true);
      expect(lines.find((l) => l.account === ACCOUNTS.AVOIR_CLIENT)!.creditMinorUnits).toBe(1200);
      expect(lines.find((l) => l.account === ACCOUNTS.VENTE_HT)!.debitMinorUnits).toBe(1000);
    });
    it('cash refund credits the cash account', () => {
      const lines = buildRefundJournalLines({
        code: 'AV-2', totalMinorUnits: 600, taxTotalMinorUnits: 100, type: 'refund', refundMethod: 'cash',
      });
      expect(journalIsBalanced(lines)).toBe(true);
      expect(lines.find((l) => l.account === ACCOUNTS.CAISSE_ESPECES)!.creditMinorUnits).toBe(600);
    });
  });

  describe('aggregateJournalByAccount + csv', () => {
    it('groups by account and stays balanced', () => {
      const day = [
        ...buildSaleJournalLines({ ticketNumber: 'T-1', totalMinorUnits: 12000, taxTotalMinorUnits: 2000, payments: [{ method: 'card', amountMinorUnits: 12000 }] }),
        ...buildSaleJournalLines({ ticketNumber: 'T-2', totalMinorUnits: 6000, taxTotalMinorUnits: 1000, payments: [{ method: 'card', amountMinorUnits: 6000 }] }),
      ];
      const agg = aggregateJournalByAccount(day);
      expect(agg.find((l) => l.account === ACCOUNTS.BANQUE_CARTE)!.debitMinorUnits).toBe(18000);
      expect(agg.find((l) => l.account === ACCOUNTS.VENTE_HT)!.creditMinorUnits).toBe(15000);
      expect(journalIsBalanced(agg)).toBe(true);
    });
    it('csv formats major units with comma', () => {
      const csv = journalToCsv([{ account: '707000', label: 'Vente HT T-1', debitMinorUnits: 0, creditMinorUnits: 10000 }]);
      expect(csv.split('\n')[0]).toBe('compte;libelle;debit;credit');
      expect(csv).toContain('707000;Vente HT T-1;0,00;100,00');
    });
  });
});
