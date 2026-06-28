import {
  isValidIdempotencyKey,
  isCouponAvailable,
  isCouponExpired,
  cooldownEnd,
  isInCooldown,
  daysRemainingInCooldown,
} from './coupon-policy';

describe('POS-070/073 coupon-policy', () => {
  const NOW = new Date('2026-06-28T12:00:00Z');

  describe('isValidIdempotencyKey', () => {
    it('requires >= 10 chars', () => {
      expect(isValidIdempotencyKey('0123456789')).toBe(true);
      expect(isValidIdempotencyKey('short')).toBe(false);
      expect(isValidIdempotencyKey('')).toBe(false);
      expect(isValidIdempotencyKey(undefined)).toBe(false);
    });
  });

  describe('isCouponAvailable', () => {
    it('only AVAILABLE is available', () => {
      expect(isCouponAvailable('AVAILABLE')).toBe(true);
      expect(isCouponAvailable('USED')).toBe(false);
      expect(isCouponAvailable('EXPIRED')).toBe(false);
    });
  });

  describe('isCouponExpired', () => {
    it('null validUntil never expires', () => {
      expect(isCouponExpired(null, NOW)).toBe(false);
    });
    it('past date = expired', () => {
      expect(isCouponExpired('2026-06-01', NOW)).toBe(true);
    });
    it('future date = not expired', () => {
      expect(isCouponExpired('2026-12-31', NOW)).toBe(false);
    });
  });

  describe('cooldown', () => {
    it('cooldownEnd adds days', () => {
      expect(cooldownEnd('2026-06-01T00:00:00Z', 15).toISOString()).toBe(
        '2026-06-16T00:00:00.000Z',
      );
    });
    it('isInCooldown true within window, false after', () => {
      expect(isInCooldown('2026-06-20T00:00:00Z', 15, NOW)).toBe(true); // ends 2026-07-05
      expect(isInCooldown('2026-06-01T00:00:00Z', 15, NOW)).toBe(false); // ends 2026-06-16
      expect(isInCooldown(null, 15, NOW)).toBe(false);
    });
    it('daysRemainingInCooldown ceils remaining days, 0 when done/absent', () => {
      // used 2026-06-20, +15j → 2026-07-05 ; NOW 2026-06-28 12:00 → 7 jours restants (ceil)
      expect(daysRemainingInCooldown('2026-06-20T00:00:00Z', 15, NOW)).toBe(7);
      expect(daysRemainingInCooldown('2026-06-01T00:00:00Z', 15, NOW)).toBe(0);
      expect(daysRemainingInCooldown(null, 15, NOW)).toBe(0);
    });
  });
});
