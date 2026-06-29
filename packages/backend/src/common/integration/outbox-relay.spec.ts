import {
  relayBackoffMs,
  isEligibleForRelay,
  relayOutcome,
  MAX_RELAY_ATTEMPTS,
} from './outbox-relay';

describe('POS outbox-relay policy', () => {
  describe('relayBackoffMs', () => {
    it('grows exponentially and caps at 1h', () => {
      expect(relayBackoffMs(0)).toBe(1000);
      expect(relayBackoffMs(1)).toBe(2000);
      expect(relayBackoffMs(3)).toBe(8000);
      expect(relayBackoffMs(50)).toBe(3600000); // capped
    });
  });

  describe('isEligibleForRelay', () => {
    it('pending → eligible, published → not', () => {
      expect(isEligibleForRelay('pending', 0)).toBe(true);
      expect(isEligibleForRelay('published', 0)).toBe(false);
    });
    it('failed retryable under cap', () => {
      expect(isEligibleForRelay('failed', 4)).toBe(true);
      expect(isEligibleForRelay('failed', 5)).toBe(false);
      expect(MAX_RELAY_ATTEMPTS).toBe(5);
    });
  });

  describe('relayOutcome', () => {
    const now = new Date('2026-06-29T10:00:00Z');
    it('success → published with timestamp', () => {
      expect(relayOutcome(true, 0, now)).toEqual({ status: 'published', attempts: 1, publishedAt: now });
    });
    it('failure under cap → pending (retry)', () => {
      expect(relayOutcome(false, 0, now)).toEqual({ status: 'pending', attempts: 1, publishedAt: null });
    });
    it('failure at cap → failed (dead-letter)', () => {
      expect(relayOutcome(false, 4, now)).toEqual({ status: 'failed', attempts: 5, publishedAt: null });
    });
  });
});
