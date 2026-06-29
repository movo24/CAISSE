import {
  isPositiveQuantity,
  sumDispatchQuantities,
  hasSufficientStock,
} from './dispatch-policy';

describe('POS stock-locations dispatch-policy', () => {
  describe('isPositiveQuantity', () => {
    it('accepts strictly positive', () => {
      expect(isPositiveQuantity(1)).toBe(true);
      expect(isPositiveQuantity(0.5)).toBe(true);
    });
    it('rejects zero / negative / non-finite', () => {
      expect(isPositiveQuantity(0)).toBe(false);
      expect(isPositiveQuantity(-3)).toBe(false);
      expect(isPositiveQuantity(NaN)).toBe(false);
      expect(isPositiveQuantity(Infinity)).toBe(false);
    });
  });

  describe('sumDispatchQuantities', () => {
    it('sums quantities', () => {
      expect(
        sumDispatchQuantities([{ quantity: 2 }, { quantity: 3 }, { quantity: 5 }]),
      ).toBe(10);
    });
    it('empty → 0', () => {
      expect(sumDispatchQuantities([])).toBe(0);
    });
  });

  describe('hasSufficientStock', () => {
    it('true when available covers required (inclusive)', () => {
      expect(hasSufficientStock(10, 10)).toBe(true);
      expect(hasSufficientStock(11, 10)).toBe(true);
    });
    it('false when short', () => {
      expect(hasSufficientStock(9, 10)).toBe(false);
    });
  });
});
