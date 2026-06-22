import { createHmac } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { LoyaltyTokenService } from './loyalty-token.service';

/**
 * M303 — loyalty QR token security. HMAC-SHA256 signed, 60s TTL, no PII in payload,
 * constant-time signature comparison. These tests lock in those guarantees (the
 * service had no spec).
 */
describe('LoyaltyTokenService (M303)', () => {
  const svc = new LoyaltyTokenService();
  const SECRET = 'card-secret-abcdef';

  // Build a token with an arbitrary payload, signed with `secret` (mirrors the
  // service format) — used to forge expired / cross-secret tokens.
  const forge = (payload: object, secret: string) => {
    const str = JSON.stringify(payload);
    const b64 = Buffer.from(str).toString('base64url');
    const sig = createHmac('sha256', secret).update(str).digest('base64url');
    return `${b64}.${sig}`;
  };

  it('a freshly generated token verifies and returns its IDs (no PII)', () => {
    const { token } = svc.generate('cust-1', 'card-1', SECRET);
    const payload = svc.verify(token, SECRET);
    expect(payload).toMatchObject({ customerId: 'cust-1', cardId: 'card-1' });
    expect(Object.keys(payload)).toEqual(expect.arrayContaining(['customerId', 'cardId', 'expiresAt']));
    // payload carries IDs + expiry only — no name/email/phone
    expect(JSON.stringify(payload)).not.toMatch(/name|email|phone/i);
  });

  it('rejects a tampered signature', () => {
    const { token } = svc.generate('cust-1', 'card-1', SECRET);
    const [body] = token.split('.');
    expect(() => svc.verify(`${body}.deadbeef`, SECRET)).toThrow(BadRequestException);
  });

  it('rejects a token signed with a different secret (rotation invalidates old tokens)', () => {
    const { token } = svc.generate('cust-1', 'card-1', 'old-secret');
    expect(() => svc.verify(token, SECRET)).toThrow(BadRequestException);
  });

  it('rejects an expired token even with a valid signature', () => {
    const expired = forge({ customerId: 'c1', cardId: 'card1', expiresAt: Date.now() - 1000 }, SECRET);
    expect(() => svc.verify(expired, SECRET)).toThrow(/expir/i);
  });

  it('rejects a malformed token', () => {
    expect(() => svc.verify('not-a-token', SECRET)).toThrow(BadRequestException);
    expect(() => svc.verify('', SECRET)).toThrow(BadRequestException);
    expect(() => svc.verify('a.b.c', SECRET)).toThrow(BadRequestException);
  });
});
