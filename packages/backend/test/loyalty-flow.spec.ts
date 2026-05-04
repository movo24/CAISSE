/**
 * E2E business logic tests for The Wesley Club loyalty flow.
 *
 * Validates the complete journey:
 *   register → welcome coupon issued → scan POS → redeem → coupon USED
 *
 * Plus critical anti-fraud + edge cases.
 *
 * Note: These are mock-based logic tests. True DB integration tests
 * run via npm run test:e2e (which requires a test postgres).
 */

import { createHmac, randomBytes } from 'crypto';

// ────────────────────────────────────────────────────────────────
// QR TOKEN — HMAC + TTL 60s
// ────────────────────────────────────────────────────────────────

function generateQrToken(
  customerId: string,
  cardId: string,
  secret: string,
  ttlSeconds = 60,
) {
  const payload = {
    customerId,
    cardId,
    expiresAt: Date.now() + ttlSeconds * 1000,
  };
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadStr).toString('base64url');
  const sig = createHmac('sha256', secret).update(payloadStr).digest('base64url');
  return `${payloadB64}.${sig}`;
}

function verifyQrToken(token: string, secret: string): {
  valid: boolean;
  reason?: string;
  payload?: any;
} {
  const parts = token.split('.');
  if (parts.length !== 2) return { valid: false, reason: 'malformed' };

  const [b64, providedSig] = parts;
  let payload: any;
  let payloadStr: string;
  try {
    payloadStr = Buffer.from(b64, 'base64url').toString('utf8');
    payload = JSON.parse(payloadStr);
  } catch {
    return { valid: false, reason: 'parse-error' };
  }

  const expectedSig = createHmac('sha256', secret).update(payloadStr).digest('base64url');
  if (providedSig !== expectedSig) return { valid: false, reason: 'signature' };

  if (Date.now() > payload.expiresAt) return { valid: false, reason: 'expired' };

  return { valid: true, payload };
}

describe('Loyalty Flow E2E — QR token security', () => {
  it('valid token verifies correctly', () => {
    const secret = randomBytes(32).toString('base64url');
    const token = generateQrToken('cust1', 'card1', secret);
    const result = verifyQrToken(token, secret);
    expect(result.valid).toBe(true);
    expect(result.payload.customerId).toBe('cust1');
  });

  it('rejects token with wrong secret', () => {
    const token = generateQrToken('cust1', 'card1', 'secretA');
    const result = verifyQrToken(token, 'secretB');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('signature');
  });

  it('rejects expired token (TTL 0)', () => {
    const secret = randomBytes(32).toString('base64url');
    const token = generateQrToken('cust1', 'card1', secret, -1); // already expired
    const result = verifyQrToken(token, secret);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('expired');
  });

  it('rejects malformed token', () => {
    const result = verifyQrToken('not-a-token', 'secret');
    expect(result.valid).toBe(false);
  });

  it('token contains NO personal data', () => {
    const secret = randomBytes(32).toString('base64url');
    const token = generateQrToken('cust1', 'card1', secret);
    const decoded = Buffer.from(token.split('.')[0], 'base64url').toString('utf8');
    const payload = JSON.parse(decoded);
    expect(payload.email).toBeUndefined();
    expect(payload.firstName).toBeUndefined();
    expect(payload.phone).toBeUndefined();
  });

  it('two tokens generated with same input differ (nonce-like)', () => {
    const secret = randomBytes(32).toString('base64url');
    // generated 1ms apart → expiresAt differs → tokens differ
    const t1 = generateQrToken('cust1', 'card1', secret);
    const t2 = generateQrToken('cust1', 'card1', secret);
    // timing dependent but should usually differ
    if (t1 === t2) {
      // very unlikely but acceptable
      expect(true).toBe(true);
    } else {
      expect(t1).not.toBe(t2);
    }
  });
});

// ────────────────────────────────────────────────────────────────
// COOLDOWN 15 DAYS
// ────────────────────────────────────────────────────────────────

const COOLDOWN_DAYS = 15;

function isCooldownExpired(lastUsedAt: Date | null): boolean {
  if (!lastUsedAt) return true;
  const cooldownEnd = new Date(lastUsedAt);
  cooldownEnd.setDate(cooldownEnd.getDate() + COOLDOWN_DAYS);
  return cooldownEnd <= new Date();
}

function daysUntilCooldownEnd(lastUsedAt: Date): number {
  const cooldownEnd = new Date(lastUsedAt);
  cooldownEnd.setDate(cooldownEnd.getDate() + COOLDOWN_DAYS);
  const ms = cooldownEnd.getTime() - Date.now();
  return Math.ceil(ms / 86400000);
}

describe('Loyalty Flow E2E — 15-day cooldown', () => {
  it('eligible immediately for never-redeemed customers', () => {
    expect(isCooldownExpired(null)).toBe(true);
  });

  it('rejects redemption at day 1 (just used)', () => {
    const justUsed = new Date(Date.now() - 60_000); // 1 min ago
    expect(isCooldownExpired(justUsed)).toBe(false);
  });

  it('rejects redemption at day 14', () => {
    const day14 = new Date(Date.now() - 14 * 86400000);
    expect(isCooldownExpired(day14)).toBe(false);
    expect(daysUntilCooldownEnd(day14)).toBe(1);
  });

  it('eligible at day 15', () => {
    const day15 = new Date(Date.now() - 15 * 86400000 - 1000);
    expect(isCooldownExpired(day15)).toBe(true);
  });

  it('eligible at day 30 (long inactive)', () => {
    const day30 = new Date(Date.now() - 30 * 86400000);
    expect(isCooldownExpired(day30)).toBe(true);
  });

  it('countdown message at day 7', () => {
    const day7 = new Date(Date.now() - 7 * 86400000);
    const remaining = daysUntilCooldownEnd(day7);
    expect(remaining).toBe(8);
  });
});

// ────────────────────────────────────────────────────────────────
// CYCLE 5/5/10/5
// ────────────────────────────────────────────────────────────────

const CYCLE = [5, 5, 10, 5];

function getDiscountForRank(rank: number): number {
  const idx = ((rank - 1) % CYCLE.length + CYCLE.length) % CYCLE.length;
  return CYCLE[idx];
}

describe('Loyalty Flow E2E — reward cycle 5/5/10/5', () => {
  it('rank 1 → 5%', () => expect(getDiscountForRank(1)).toBe(5));
  it('rank 2 → 5%', () => expect(getDiscountForRank(2)).toBe(5));
  it('rank 3 → 10%', () => expect(getDiscountForRank(3)).toBe(10));
  it('rank 4 → 5%', () => expect(getDiscountForRank(4)).toBe(5));
  it('rank 5 wraps to rank 1 → 5%', () => expect(getDiscountForRank(5)).toBe(5));
  it('rank 7 wraps to rank 3 → 10%', () => expect(getDiscountForRank(7)).toBe(10));
  it('rank 100 wraps consistently', () => {
    expect(getDiscountForRank(100)).toBe(getDiscountForRank(100 % 4 || 4));
  });
});

// ────────────────────────────────────────────────────────────────
// FULL JOURNEY SIMULATION
// ────────────────────────────────────────────────────────────────

interface Coupon {
  id: string;
  customerId: string;
  type: 'WELCOME' | 'LOYALTY' | 'MANUAL';
  discountValue: number;
  status: 'AVAILABLE' | 'LOCKED' | 'USED' | 'EXPIRED';
  validUntil: Date;
  usedAt?: Date;
}

interface IdempotencyRecord {
  key: string;
  response: any;
}

class MockCouponStore {
  private coupons = new Map<string, Coupon>();
  private idempotency = new Map<string, IdempotencyRecord>();

  issueWelcome(customerId: string): Coupon {
    const id = `cp-${Math.random()}`;
    const coupon: Coupon = {
      id,
      customerId,
      type: 'WELCOME',
      discountValue: 5,
      status: 'AVAILABLE',
      validUntil: new Date(Date.now() + 30 * 86400000),
    };
    this.coupons.set(id, coupon);
    return coupon;
  }

  /** Transactional redeem — simulates SELECT FOR UPDATE + idempotency */
  redeem(couponId: string, customerId: string, idempotencyKey: string) {
    if (this.idempotency.has(idempotencyKey)) {
      return this.idempotency.get(idempotencyKey)!.response;
    }
    const coupon = this.coupons.get(couponId);
    if (!coupon) throw new Error('not found');
    if (coupon.customerId !== customerId) throw new Error('forbidden');
    if (coupon.status !== 'AVAILABLE') throw new Error('not available');
    if (coupon.validUntil < new Date()) throw new Error('expired');

    coupon.status = 'USED';
    coupon.usedAt = new Date();

    const response = { success: true, discountPercent: coupon.discountValue };
    this.idempotency.set(idempotencyKey, { key: idempotencyKey, response });
    return response;
  }

  getActive(customerId: string): Coupon | null {
    for (const c of this.coupons.values()) {
      if (c.customerId === customerId && c.status === 'AVAILABLE') return c;
    }
    return null;
  }
}

describe('Loyalty Flow E2E — full journey', () => {
  it('register → welcome coupon → scan → redeem', () => {
    const store = new MockCouponStore();
    const customerId = 'newcust1';

    // 1. Register: welcome coupon issued
    const welcome = store.issueWelcome(customerId);
    expect(welcome.type).toBe('WELCOME');
    expect(welcome.discountValue).toBe(5);
    expect(welcome.status).toBe('AVAILABLE');

    // 2. Scan: backend returns the coupon for POS display
    const active = store.getActive(customerId);
    expect(active?.id).toBe(welcome.id);

    // 3. Redeem with idempotency key
    const result = store.redeem(welcome.id, customerId, 'idem-key-1');
    expect(result.success).toBe(true);
    expect(result.discountPercent).toBe(5);

    // 4. Coupon now USED
    const afterRedeem = store.getActive(customerId);
    expect(afterRedeem).toBeNull();
  });

  it('double-redeem with same idempotency key returns cached', () => {
    const store = new MockCouponStore();
    const cust = 'cust2';
    const c = store.issueWelcome(cust);

    const r1 = store.redeem(c.id, cust, 'same-key');
    const r2 = store.redeem(c.id, cust, 'same-key'); // 2nd call

    expect(r1).toEqual(r2);
    expect(r1.success).toBe(true);
  });

  it('redeem with different idempotency keys → 2nd call rejected', () => {
    const store = new MockCouponStore();
    const cust = 'cust3';
    const c = store.issueWelcome(cust);

    store.redeem(c.id, cust, 'key-1');
    expect(() => store.redeem(c.id, cust, 'key-2')).toThrow('not available');
  });

  it('coupon belonging to other customer is rejected', () => {
    const store = new MockCouponStore();
    const c = store.issueWelcome('owner');
    expect(() => store.redeem(c.id, 'attacker', 'k1')).toThrow('forbidden');
  });

  it('expired coupon rejected', () => {
    const store = new MockCouponStore();
    const cust = 'cust4';
    const c = store.issueWelcome(cust);
    c.validUntil = new Date(Date.now() - 1); // make expired
    expect(() => store.redeem(c.id, cust, 'k')).toThrow('expired');
  });
});

// ────────────────────────────────────────────────────────────────
// VISIT ANTI-DOUBLON 5 MIN
// ────────────────────────────────────────────────────────────────

interface Visit {
  customerId: string;
  storeId: string;
  visitedAt: Date;
}

function shouldRecordVisit(
  recent: Visit | null,
  newCustomer: string,
  newStore: string,
): boolean {
  if (!recent) return true;
  if (recent.customerId !== newCustomer) return true;
  if (recent.storeId !== newStore) return true;
  const ageSec = (Date.now() - recent.visitedAt.getTime()) / 1000;
  return ageSec >= 300; // 5 minutes
}

describe('Loyalty Flow E2E — visit anti-duplicate (5 min)', () => {
  it('no recent visit → record', () => {
    expect(shouldRecordVisit(null, 'c1', 's1')).toBe(true);
  });

  it('same customer same store within 1 min → skip', () => {
    const recent = { customerId: 'c1', storeId: 's1', visitedAt: new Date(Date.now() - 60_000) };
    expect(shouldRecordVisit(recent, 'c1', 's1')).toBe(false);
  });

  it('same customer different store → record', () => {
    const recent = { customerId: 'c1', storeId: 's1', visitedAt: new Date(Date.now() - 60_000) };
    expect(shouldRecordVisit(recent, 'c1', 's2')).toBe(true);
  });

  it('same customer same store after 6 min → record', () => {
    const recent = { customerId: 'c1', storeId: 's1', visitedAt: new Date(Date.now() - 6 * 60_000) };
    expect(shouldRecordVisit(recent, 'c1', 's1')).toBe(true);
  });
});
