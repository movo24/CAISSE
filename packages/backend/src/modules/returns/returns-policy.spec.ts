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

    describe('cumulative rounding — no lost/over-refunded centime (POS-INT-127)', () => {
      it('three 1-unit returns of a 1000/qty3 line sum to exactly 1000', () => {
        // before the fix: 333+333+333 = 999 (1 centime lost). Now exact.
        const r1 = computeLineRefund(1000, 1, 3, 0); // 333
        const r2 = computeLineRefund(1000, 1, 3, 1); // 334
        const r3 = computeLineRefund(1000, 1, 3, 2); // 333
        expect(r1 + r2 + r3).toBe(1000);
        expect([r1, r2, r3]).toEqual([333, 334, 333]);
      });

      it('any split order of a fully-returned line sums to the line total', () => {
        const total = 1000, sold = 7;
        for (const split of [[1,1,1,1,1,1,1], [3,4], [2,2,3], [5,2], [6,1], [7]]) {
          let acc = 0, refunded = 0;
          for (const q of split) { refunded += computeLineRefund(total, q, sold, acc); acc += q; }
          expect(refunded).toBe(total);
        }
      });

      it('back-compat: single return with no prior matches the old proportional value', () => {
        expect(computeLineRefund(1000, 1, 3)).toBe(333); // alreadyReturned defaults to 0
        expect(computeLineRefund(900, 1, 3)).toBe(300);
        expect(computeLineRefund(1000, 2, 2)).toBe(1000);
      });

      it('partial returns that do not complete the line never exceed proportional', () => {
        // return 2 of 3 (1000): cumulative 0→2 = round(2000/3)=667
        expect(computeLineRefund(1000, 2, 3, 0)).toBe(667);
        // a later 1 unit completes: 1000-667 = 333
        expect(computeLineRefund(1000, 1, 3, 2)).toBe(333);
      });
    });
  });
});
