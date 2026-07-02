/**
 * P316 (cycle H) — TD-RESP-PIN: rate limiting on responsable-PIN attempts.
 *
 * The manual-discount authorization reuses manager/admin employee PINs
 * (verifyResponsablePin). Until now nothing throttled guesses. This pure,
 * clock-injectable limiter locks a store's responsable-PIN verification after
 * MAX_ATTEMPTS consecutive failures for LOCK_MS (success resets the counter).
 *
 * Scope & honesty:
 *  - keyed per STORE (the attacker model is a cashier guessing on their till;
 *    a per-employee key is impossible — the PIN is not tied to a claimed id).
 *  - IN-MEMORY: consistent with the existing cache posture (single-instance;
 *    multi-pod prod would need the Redis-backed limiter — same caveat as
 *    ALLOW_INMEMORY_CACHE, documented).
 *  - fail-closed while locked: verification refuses WITHOUT comparing.
 */

export const RESP_PIN_MAX_ATTEMPTS = 5;
export const RESP_PIN_LOCK_MS = 15 * 60 * 1000;

interface Bucket {
  failures: number;
  lockedUntil: number; // epoch ms, 0 = not locked
}

export class PinAttemptLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly maxAttempts = RESP_PIN_MAX_ATTEMPTS,
    private readonly lockMs = RESP_PIN_LOCK_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** True when the key is currently locked out (expired locks self-clear). */
  isLocked(key: string): boolean {
    const b = this.buckets.get(key);
    if (!b) return false;
    if (b.lockedUntil && b.lockedUntil <= this.now()) {
      this.buckets.delete(key); // lock expired → clean slate
      return false;
    }
    return b.lockedUntil > 0;
  }

  /** Record a failed attempt; returns true if this failure triggered the lock. */
  recordFailure(key: string): boolean {
    const b = this.buckets.get(key) ?? { failures: 0, lockedUntil: 0 };
    b.failures += 1;
    if (b.failures >= this.maxAttempts) {
      b.lockedUntil = this.now() + this.lockMs;
    }
    this.buckets.set(key, b);
    return b.lockedUntil > 0;
  }

  /** A successful verification clears the counter. */
  recordSuccess(key: string): void {
    this.buckets.delete(key);
  }

  /** Remaining lock time (ms), 0 when not locked. */
  remainingMs(key: string): number {
    const b = this.buckets.get(key);
    if (!b || !b.lockedUntil) return 0;
    return Math.max(0, b.lockedUntil - this.now());
  }
}
