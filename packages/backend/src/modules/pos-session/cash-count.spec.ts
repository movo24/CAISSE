import { countCash, reconcileCash } from './cash-count';

describe('POS-017 cash counting & reconciliation', () => {
  describe('countCash', () => {
    it('sums a denomination breakdown (centimes)', () => {
      // 2×20€ + 3×5€ + 4×1€ + 5×0.50€ = 4000 + 1500 + 400 + 250 = 6150
      expect(
        countCash([
          { valueMinorUnits: 2000, count: 2 },
          { valueMinorUnits: 500, count: 3 },
          { valueMinorUnits: 100, count: 4 },
          { valueMinorUnits: 50, count: 5 },
        ]),
      ).toBe(6150);
    });
    it('empty drawer = 0', () => {
      expect(countCash([])).toBe(0);
    });
    it('rejects negative count', () => {
      expect(() => countCash([{ valueMinorUnits: 100, count: -1 }])).toThrow();
    });
    it('rejects non-integer value', () => {
      expect(() => countCash([{ valueMinorUnits: 1.5, count: 1 }])).toThrow();
    });
  });

  describe('reconcileCash', () => {
    it('balanced when counted equals expected', () => {
      const r = reconcileCash({
        openingFloatMinorUnits: 10000,
        cashSalesMinorUnits: 5000,
        cashRefundsMinorUnits: 1000,
        countedMinorUnits: 14000,
      });
      expect(r.expectedMinorUnits).toBe(14000);
      expect(r.varianceMinorUnits).toBe(0);
      expect(r.status).toBe('balanced');
    });
    it('over when drawer has more than expected', () => {
      const r = reconcileCash({
        openingFloatMinorUnits: 10000,
        cashSalesMinorUnits: 5000,
        cashRefundsMinorUnits: 0,
        countedMinorUnits: 15500,
      });
      expect(r.expectedMinorUnits).toBe(15000);
      expect(r.varianceMinorUnits).toBe(500);
      expect(r.status).toBe('over');
    });
    it('short when drawer has less than expected', () => {
      const r = reconcileCash({
        openingFloatMinorUnits: 10000,
        cashSalesMinorUnits: 5000,
        cashRefundsMinorUnits: 0,
        countedMinorUnits: 14800,
      });
      expect(r.varianceMinorUnits).toBe(-200);
      expect(r.status).toBe('short');
    });
    it('tolerance absorbs a small variance as balanced', () => {
      const r = reconcileCash({
        openingFloatMinorUnits: 10000,
        cashSalesMinorUnits: 0,
        cashRefundsMinorUnits: 0,
        countedMinorUnits: 10005,
        toleranceMinorUnits: 10,
      });
      expect(r.varianceMinorUnits).toBe(5);
      expect(r.status).toBe('balanced');
      expect(r.withinTolerance).toBe(true);
    });
  });
});
