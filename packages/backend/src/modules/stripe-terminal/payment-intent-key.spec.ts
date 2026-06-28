import { createHash } from 'crypto';
import { paymentIntentIdempotencyKey } from './payment-intent-key';

describe('POS-033/041 paymentIntentIdempotencyKey', () => {
  it('matches the documented sha256 of the joined fields', () => {
    const expected = createHash('sha256')
      .update('s1:T-000001:1500:eur:e1')
      .digest('hex');
    expect(paymentIntentIdempotencyKey('s1', 'T-000001', 1500, 'eur', 'e1')).toBe(expected);
  });

  it('is deterministic for identical inputs (retry → same key, no double charge)', () => {
    expect(paymentIntentIdempotencyKey('s1', 'T-1', 100, 'eur', 'e1')).toBe(
      paymentIntentIdempotencyKey('s1', 'T-1', 100, 'eur', 'e1'),
    );
  });

  it('changes when amount changes', () => {
    expect(paymentIntentIdempotencyKey('s1', 'T-1', 100, 'eur')).not.toBe(
      paymentIntentIdempotencyKey('s1', 'T-1', 200, 'eur'),
    );
  });

  it('changes when ticket changes', () => {
    expect(paymentIntentIdempotencyKey('s1', 'T-1', 100, 'eur')).not.toBe(
      paymentIntentIdempotencyKey('s1', 'T-2', 100, 'eur'),
    );
  });

  it('missing employee is stable (empty segment)', () => {
    const expected = createHash('sha256').update('s1:T-1:100:eur:').digest('hex');
    expect(paymentIntentIdempotencyKey('s1', 'T-1', 100, 'eur')).toBe(expected);
  });
});
