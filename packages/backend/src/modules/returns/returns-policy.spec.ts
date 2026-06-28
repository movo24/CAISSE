import { returnableQuantity, computeLineRefund } from './returns-policy';

describe('POS-046 returns-policy', () => {
  describe('returnableQuantity', () => {
    it('sold minus already returned', () => {
      expect(returnableQuantity(5, 2)).toBe(3);
      expect(returnableQuantity(5, 0)).toBe(5);
    });
    it('never negative', () => {
      expect(returnableQuantity(2, 5)).toBe(0);
    });
  });

  describe('computeLineRefund', () => {
    it('full line refund', () => {
      expect(computeLineRefund(1000, 2, 2)).toBe(1000);
    });
    it('partial refund proportional to net line total', () => {
      // line of 3 units totalling 900 (net, e.g. after discount) → 1 unit = 300
      expect(computeLineRefund(900, 1, 3)).toBe(300);
    });
    it('rounds to nearest cent', () => {
      // 1000 over 3 units, return 1 → 333.33 → 333
      expect(computeLineRefund(1000, 1, 3)).toBe(333);
    });
    it('discounted line refunds proportionally (never more than paid)', () => {
      // sold 2 for net 1500 (was 2000 before discount) → return 1 = 750, not 1000
      expect(computeLineRefund(1500, 1, 2)).toBe(750);
    });
    it('zero sold qty = 0 (guard)', () => {
      expect(computeLineRefund(1000, 1, 0)).toBe(0);
    });
  });
});
