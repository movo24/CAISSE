import {
  buyXGetDiscount,
  percentageDiscount,
  firstPurchaseDiscount,
  lineTotal,
  FIRST_PURCHASE_RATE,
} from './promo-discount';

describe('POS promo-discount', () => {
  describe('buyXGetDiscount', () => {
    it('no full group → 0', () => {
      // buy 2 get discount → groupSize 3 ; qty 2 → 0 groups
      expect(buyXGetDiscount(2, 2, 1000, 50)).toBe(0);
    });
    it('one group → one discounted item', () => {
      // groupSize 3, qty 3 → 1 discounted ; 50% of 1000 = 500
      expect(buyXGetDiscount(3, 2, 1000, 50)).toBe(500);
    });
    it('multiple groups scale', () => {
      // groupSize 3, qty 7 → 2 discounted ; 30% of 1000 = 300 → 600
      expect(buyXGetDiscount(7, 2, 1000, 30)).toBe(600);
    });
    it('rounds per item', () => {
      // 33% of 999 = 329.67 → round 330 ; qty 3 → 1 group → 330
      expect(buyXGetDiscount(3, 2, 999, 33)).toBe(330);
    });
  });

  describe('percentageDiscount', () => {
    it('rounds', () => {
      expect(percentageDiscount(1000, 10)).toBe(100);
      expect(percentageDiscount(999, 33)).toBe(330);
    });
  });

  describe('firstPurchaseDiscount', () => {
    it('5% rounded', () => {
      expect(FIRST_PURCHASE_RATE).toBe(0.05);
      expect(firstPurchaseDiscount(1000)).toBe(50);
      expect(firstPurchaseDiscount(999)).toBe(50); // 49.95 → 50
    });
  });

  describe('lineTotal', () => {
    it('multiplies', () => {
      expect(lineTotal(250, 4)).toBe(1000);
    });
  });
});
