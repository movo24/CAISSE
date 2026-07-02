import { PinAttemptLimiter, RESP_PIN_MAX_ATTEMPTS, RESP_PIN_LOCK_MS } from './pin-attempt-limiter';

// P316 (cycle H) — TD-RESP-PIN: throttle on responsable-PIN guesses.

describe('PinAttemptLimiter (TD-RESP-PIN)', () => {
  const clock = { t: 1_000_000 };
  const mk = () => new PinAttemptLimiter(RESP_PIN_MAX_ATTEMPTS, RESP_PIN_LOCK_MS, () => clock.t);

  it('locks after 5 consecutive failures, and only then', () => {
    const l = mk();
    for (let i = 1; i <= 4; i++) {
      expect(l.recordFailure('store-1')).toBe(false);
      expect(l.isLocked('store-1')).toBe(false);
    }
    expect(l.recordFailure('store-1')).toBe(true); // 5th → locked
    expect(l.isLocked('store-1')).toBe(true);
    expect(l.remainingMs('store-1')).toBe(RESP_PIN_LOCK_MS);
  });

  it('a success resets the counter (no lock on 4 fails + success + 4 fails)', () => {
    const l = mk();
    for (let i = 0; i < 4; i++) l.recordFailure('store-1');
    l.recordSuccess('store-1');
    for (let i = 0; i < 4; i++) expect(l.recordFailure('store-1')).toBe(false);
    expect(l.isLocked('store-1')).toBe(false);
  });

  it('the lock expires after 15 minutes and the slate is clean', () => {
    const l = mk();
    for (let i = 0; i < 5; i++) l.recordFailure('store-1');
    expect(l.isLocked('store-1')).toBe(true);
    clock.t += RESP_PIN_LOCK_MS - 1;
    expect(l.isLocked('store-1')).toBe(true);
    clock.t += 2; // past expiry
    expect(l.isLocked('store-1')).toBe(false);
    expect(l.recordFailure('store-1')).toBe(false); // counter restarted at 1
  });

  it('stores are isolated: locking store-1 never affects store-2', () => {
    const l = mk();
    for (let i = 0; i < 5; i++) l.recordFailure('store-1');
    expect(l.isLocked('store-1')).toBe(true);
    expect(l.isLocked('store-2')).toBe(false);
    expect(l.recordFailure('store-2')).toBe(false);
  });
});
