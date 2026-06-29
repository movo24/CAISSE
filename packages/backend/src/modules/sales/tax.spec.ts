import { extractLineTax, sumLineTax, taxBreakdownByRate } from './tax';

// Reference: the exact inline formula createSale used before extraction.
const inline = (gross: number, rate: number) =>
  Math.round(gross * (rate / (100 + rate)));

describe('POS-063 VAT extraction (tax.ts)', () => {
  describe('extractLineTax', () => {
    it('20% on 1000 = 167', () => {
      expect(extractLineTax(1000, 20)).toBe(167);
    });
    it('5.5% on 1055 = 55', () => {
      expect(extractLineTax(1055, 5.5)).toBe(55);
    });
    it('rate 0 or gross 0 = 0', () => {
      expect(extractLineTax(1000, 0)).toBe(0);
      expect(extractLineTax(0, 20)).toBe(0);
    });
    it('matches the original inline formula across a range (behavior-preserving)', () => {
      for (let gross = 0; gross <= 5000; gross += 137) {
        for (const rate of [0, 5.5, 10, 20]) {
          expect(extractLineTax(gross, rate)).toBe(inline(gross, rate));
        }
      }
    });
  });

  describe('sumLineTax', () => {
    it('sums per-line VAT (per-line rounding)', () => {
      const lines = [
        { lineTotalMinorUnits: 1000, taxRate: 20 }, // 167
        { lineTotalMinorUnits: 500, taxRate: 20 }, // 83
      ];
      expect(sumLineTax(lines)).toBe(250);
    });
    it('empty = 0', () => {
      expect(sumLineTax([])).toBe(0);
    });
  });

  describe('taxBreakdownByRate', () => {
    const lines = [
      { lineTotalMinorUnits: 1200, taxRate: 20 }, // tax 200
      { lineTotalMinorUnits: 1100, taxRate: 10 }, // tax 100
      { lineTotalMinorUnits: 600, taxRate: 20 }, // tax 100
    ];
    it('groups per rate, sorted, with base = gross - tax', () => {
      expect(taxBreakdownByRate(lines)).toEqual([
        { rate: 10, grossMinorUnits: 1100, taxMinorUnits: 100, baseMinorUnits: 1000 },
        { rate: 20, grossMinorUnits: 1800, taxMinorUnits: 300, baseMinorUnits: 1500 },
      ]);
    });
    it('Σ tax equals sumLineTax (consistent rounding)', () => {
      const total = taxBreakdownByRate(lines).reduce((s, b) => s + b.taxMinorUnits, 0);
      expect(total).toBe(sumLineTax(lines));
    });
    it('empty → []', () => {
      expect(taxBreakdownByRate([])).toEqual([]);
    });
  });
});
