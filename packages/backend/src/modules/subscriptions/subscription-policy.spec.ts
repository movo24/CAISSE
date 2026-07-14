import {
  isUnlimited,
  isWithinLimit,
  subscriptionAccessDenial,
} from './subscription-policy';

describe('POS subscription-policy', () => {
  describe('limits', () => {
    it('-1 = unlimited', () => {
      expect(isUnlimited(-1)).toBe(true);
      expect(isWithinLimit(9999, -1)).toBe(true);
    });
    it('within when count < max', () => {
      expect(isWithinLimit(99, 100)).toBe(true);
    });
    it('denied when count >= max', () => {
      expect(isWithinLimit(100, 100)).toBe(false);
      expect(isWithinLimit(101, 100)).toBe(false);
    });
  });

  describe('subscriptionAccessDenial', () => {
    const now = new Date('2026-06-28T12:00:00Z');
    it('active/trial = allowed (null)', () => {
      expect(subscriptionAccessDenial('active', null, now)).toBeNull();
      expect(subscriptionAccessDenial('trial', null, now)).toBeNull();
    });
    it('suspended = always denied', () => {
      expect(subscriptionAccessDenial('suspended', '2099-01-01', now)).toBe('suspended');
    });
    it('cancelled within grace = allowed', () => {
      expect(subscriptionAccessDenial('cancelled', '2026-07-30', now)).toBeNull();
    });
    it('cancelled past period end = expired', () => {
      expect(subscriptionAccessDenial('cancelled', '2026-06-01', now)).toBe('expired');
    });
  });
});
