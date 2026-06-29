import {
  buildDailyAccountingExport,
  toAccountingCsv,
  AccountingExportInput,
} from './accounting-export';

const input: AccountingExportInput = {
  date: '2026-06-28',
  storeId: 'store-1',
  totalRevenueMinorUnits: 10000, // 100.00 TTC
  totalTaxMinorUnits: 1667, // ~16.67 TVA (20%)
  cashTotalMinorUnits: 6000,
  cardTotalMinorUnits: 3500,
  discountTotalMinorUnits: 500,
  transactionCount: 12,
};

describe('POS-100 accounting-export', () => {
  describe('buildDailyAccountingExport', () => {
    it('computes HT = TTC - TVA', () => {
      const r = buildDailyAccountingExport(input);
      expect(r.totalTtcMinorUnits).toBe(10000);
      expect(r.totalTvaMinorUnits).toBe(1667);
      expect(r.totalHtMinorUnits).toBe(8333);
    });
    it('other tenders = TTC - cash - card (never negative)', () => {
      const r = buildDailyAccountingExport(input);
      expect(r.otherTendersMinorUnits).toBe(500); // 10000-6000-3500
    });
    it('clamps other tenders to 0 if cash+card exceed ttc', () => {
      const r = buildDailyAccountingExport({ ...input, cashTotalMinorUnits: 9000, cardTotalMinorUnits: 3500 });
      expect(r.otherTendersMinorUnits).toBe(0);
    });
  });

  describe('toAccountingCsv', () => {
    it('emits a header + a ";"-separated row with major-unit amounts', () => {
      const csv = toAccountingCsv([buildDailyAccountingExport(input)]);
      const [header, row] = csv.split('\n');
      expect(header).toBe('date;store_id;total_ttc;total_ht;total_tva;cash;card;autres;remise;nb_tickets');
      expect(row).toBe('2026-06-28;store-1;100.00;83.33;16.67;60.00;35.00;5.00;5.00;12');
    });
    it('empty rows = header only', () => {
      expect(toAccountingCsv([])).toBe('date;store_id;total_ttc;total_ht;total_tva;cash;card;autres;remise;nb_tickets');
    });
    it('neutralizes a formula-injection payload in storeId (POS-INT-114)', () => {
      const row = buildDailyAccountingExport({ ...input, storeId: '=cmd' });
      const csv = toAccountingCsv([row]);
      expect(csv).toContain(";'=cmd;"); // apostrophe-prefixed, not executable
      expect(csv).not.toContain(';=cmd;');
    });
  });
});
