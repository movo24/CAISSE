import {
  tokenExpiresAt,
  isTokenExpired,
  constantTimeEqual,
  hasRequiredClaims,
  isCardActive,
  QR_TTL_SECONDS,
} from './qr-token';

describe('POS loyalty qr-token', () => {
  describe('tokenExpiresAt / TTL', () => {
    it('adds the 60s TTL', () => {
      expect(QR_TTL_SECONDS).toBe(60);
      expect(tokenExpiresAt(1_000_000)).toBe(1_000_000 + 60_000);
    });
    it('honours custom TTL', () => {
      expect(tokenExpiresAt(0, 30)).toBe(30_000);
    });
  });

  describe('isTokenExpired', () => {
    it('not expired before/at expiry', () => {
      expect(isTokenExpired(1000, 999)).toBe(false);
      expect(isTokenExpired(1000, 1000)).toBe(false); // strict > (legacy)
    });
    it('expired strictly after', () => {
      expect(isTokenExpired(1000, 1001)).toBe(true);
    });
  });

  describe('constantTimeEqual', () => {
    it('true for equal strings', () => {
      expect(constantTimeEqual('abc123', 'abc123')).toBe(true);
    });
    it('false for different content or length', () => {
      expect(constantTimeEqual('abc123', 'abc124')).toBe(false);
      expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    });
  });

  describe('hasRequiredClaims', () => {
    it('requires both IDs', () => {
      expect(hasRequiredClaims({ customerId: 'c', cardId: 'k' })).toBe(true);
      expect(hasRequiredClaims({ customerId: 'c' })).toBe(false);
      expect(hasRequiredClaims({ cardId: 'k' })).toBe(false);
      expect(hasRequiredClaims({})).toBe(false);
    });
  });

  describe('isCardActive', () => {
    it('only ACTIVE passes', () => {
      expect(isCardActive('ACTIVE')).toBe(true);
      expect(isCardActive('SUSPENDED')).toBe(false);
      expect(isCardActive(null)).toBe(false);
    });
  });
});
