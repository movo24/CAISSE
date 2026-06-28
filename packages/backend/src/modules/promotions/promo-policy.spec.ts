import { isPromoActive, dedupeBestPerProduct, isUsageLimitReached } from './promo-policy';

describe('POS-073 promo-policy', () => {
  const NOW = new Date('2026-06-28T12:00:00Z');

  describe('isPromoActive', () => {
    it('inactive flag = not active', () => {
      expect(
        isPromoActive({ startDate: '2026-01-01', endDate: null, isActive: false }, NOW),
      ).toBe(false);
    });
    it('not yet started = not active', () => {
      expect(
        isPromoActive({ startDate: '2026-07-01', endDate: null, isActive: true }, NOW),
      ).toBe(false);
    });
    it('expired = not active', () => {
      expect(
        isPromoActive({ startDate: '2026-01-01', endDate: '2026-06-01', isActive: true }, NOW),
      ).toBe(false);
    });
    it('within window = active', () => {
      expect(
        isPromoActive({ startDate: '2026-06-01', endDate: '2026-12-31', isActive: true }, NOW),
      ).toBe(true);
    });
    it('null end date + started = active', () => {
      expect(
        isPromoActive({ startDate: '2026-06-01', endDate: null, isActive: true }, NOW),
      ).toBe(true);
    });
  });

  describe('isUsageLimitReached (POS-073)', () => {
    it('null limit = unlimited (never reached)', () => {
      expect(isUsageLimitReached(999, null)).toBe(false);
      expect(isUsageLimitReached(0, undefined)).toBe(false);
    });
    it('reached when count >= limit', () => {
      expect(isUsageLimitReached(10, 10)).toBe(true);
      expect(isUsageLimitReached(11, 10)).toBe(true);
    });
    it('not reached when count < limit', () => {
      expect(isUsageLimitReached(9, 10)).toBe(false);
    });
  });

  describe('dedupeBestPerProduct (anti-stacking)', () => {
    it('keeps the largest discount per product', () => {
      const out = dedupeBestPerProduct([
        { promoId: 'a', productId: 'p1', discountMinorUnits: 100 },
        { promoId: 'b', productId: 'p1', discountMinorUnits: 250 },
        { promoId: 'c', productId: 'p2', discountMinorUnits: 50 },
      ]);
      expect(out).toHaveLength(2);
      expect(out.find((x) => x.productId === 'p1')!.promoId).toBe('b');
      expect(out.find((x) => x.productId === 'p2')!.discountMinorUnits).toBe(50);
    });
    it('single promo per product unchanged', () => {
      const input = [{ promoId: 'a', productId: 'p1', discountMinorUnits: 100 }];
      expect(dedupeBestPerProduct(input)).toEqual(input);
    });
    it('empty list = empty', () => {
      expect(dedupeBestPerProduct([])).toEqual([]);
    });
  });
});
