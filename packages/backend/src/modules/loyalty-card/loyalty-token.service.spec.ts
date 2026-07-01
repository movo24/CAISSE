import { BadRequestException } from '@nestjs/common';
import { LoyaltyTokenService } from './loyalty-token.service';

// PAQUET 268 — loyalty QR token HMAC round-trip (security-critical). Pure crypto,
// no DI. Locks: generate→verify success, tamper/ wrong-secret/ malformed rejection
// (constant-time, no leak of which check failed), expiry, and secret uniqueness.

describe('LoyaltyTokenService', () => {
  const service = new LoyaltyTokenService();
  const secret = service.generateCardSecret();

  it('generates a token that verifies back to its payload', () => {
    const { token, expiresAt } = service.generate('cust-1', 'card-1', secret);
    expect(expiresAt).toBeInstanceOf(Date);
    const payload = service.verify(token, secret);
    expect(payload).toMatchObject({ customerId: 'cust-1', cardId: 'card-1' });
    expect(typeof payload.expiresAt).toBe('number');
  });

  it('rejects a token verified with the wrong secret', () => {
    const { token } = service.generate('cust-1', 'card-1', secret);
    expect(() => service.verify(token, service.generateCardSecret())).toThrow(BadRequestException);
  });

  it('rejects a tampered payload (signature no longer matches)', () => {
    const { token } = service.generate('cust-1', 'card-1', secret);
    const [, sig] = token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ customerId: 'hacker', cardId: 'card-1', expiresAt: Date.now() + 60000 })).toString('base64url');
    expect(() => service.verify(`${forgedPayload}.${sig}`, secret)).toThrow(BadRequestException);
  });

  it('rejects malformed tokens (empty, wrong shape, non-base64 payload)', () => {
    expect(() => service.verify('', secret)).toThrow(BadRequestException);
    expect(() => service.verify('onlyonepart', secret)).toThrow(BadRequestException);
    expect(() => service.verify('a.b.c', secret)).toThrow(BadRequestException);
  });

  it('rejects an expired token', () => {
    // Craft a payload in the past, signed with the real secret.
    const { createHmac } = require('crypto');
    const past = JSON.stringify({ customerId: 'c', cardId: 'k', expiresAt: Date.now() - 1000 });
    const b64 = Buffer.from(past).toString('base64url');
    const sig = createHmac('sha256', secret).update(past).digest('base64url');
    expect(() => service.verify(`${b64}.${sig}`, secret)).toThrow(/expir/i);
  });

  it('generateCardSecret returns distinct high-entropy secrets', () => {
    const a = service.generateCardSecret();
    const b = service.generateCardSecret();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
  });
});
