import { applyStockAdjustment, inventoryVariance } from './inventory-adjust';

describe('POS-085 inventory-adjust', () => {
  describe('applyStockAdjustment', () => {
    it('delta adds to current', () => {
      expect(applyStockAdjustment('delta', 10, 5)).toBe(15);
    });
    it('delta never goes below 0', () => {
      expect(applyStockAdjustment('delta', 3, -10)).toBe(0);
    });
    it('absolute replaces current with the count', () => {
      expect(applyStockAdjustment('absolute', 10, 7)).toBe(7);
    });
    it('absolute clamps negatives to 0', () => {
      expect(applyStockAdjustment('absolute', 10, -2)).toBe(0);
    });
  });

  describe('inventoryVariance', () => {
    it('surplus is positive', () => {
      expect(inventoryVariance(12, 10)).toBe(2);
    });
    it('shortage is negative', () => {
      expect(inventoryVariance(8, 10)).toBe(-2);
    });
    it('exact match is zero', () => {
      expect(inventoryVariance(10, 10)).toBe(0);
    });
  });
});
