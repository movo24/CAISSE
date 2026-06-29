import {
  computeMaxAllowedDiscount,
  discountPercentOfSubtotal,
} from './discount-totals';

describe('POS sales discount-totals', () => {
  describe('computeMaxAllowedDiscount', () => {
    it('floors subtotal × pct%', () => {
      expect(computeMaxAllowedDiscount(1000, 30)).toBe(300);
      expect(computeMaxAllowedDiscount(999, 30)).toBe(299); // 299.7 floored
      expect(computeMaxAllowedDiscount(1000, 5)).toBe(50);
    });
  });

  describe('discountPercentOfSubtotal', () => {
    it('rounds to 2 decimals', () => {
      expect(discountPercentOfSubtotal(300, 1000)).toBe(30);
      expect(discountPercentOfSubtotal(333, 1000)).toBe(33.3);
      expect(discountPercentOfSubtotal(1, 3)).toBe(33.33);
    });
    it('null when subtotal 0 (legacy audit payload)', () => {
      expect(discountPercentOfSubtotal(100, 0)).toBeNull();
    });
  });
});
