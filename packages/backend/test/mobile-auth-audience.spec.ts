/**
 * MobileAuthGuard — audience isolation (security regression guard).
 *
 * Encodes the requirement: a mobile token MUST carry aud='mobile-app', and an
 * employee-style token (no aud, or a different aud) MUST NOT pass the mobile guard.
 * This holds on current code — the test locks it so a future change can't silently
 * drop the audience check (the GO-prep flagged this as UNCLEAR; it is now pinned).
 */
import * as jwt from 'jsonwebtoken';
import { UnauthorizedException } from '@nestjs/common';
import { MobileAuthGuard } from '../src/common/guards/mobile-auth.guard';

describe('MobileAuthGuard — audience isolation', () => {
  const guard = new MobileAuthGuard();
  const SECRET = 'a-test-secret-at-least-32-chars-long-xx';
  const sub = '11111111-1111-1111-1111-111111111111';

  beforeAll(() => { process.env.JWT_SECRET = SECRET; });

  const ctx = (authHeader?: string) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ headers: authHeader ? { authorization: authHeader } : {} }) }) }) as any;

  it('accepts a token with aud=mobile-app and exposes only the customer id', () => {
    const token = jwt.sign({ sub, email: 'a@b.c' }, SECRET, { audience: 'mobile-app', expiresIn: '15m' });
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    const c = { switchToHttp: () => ({ getRequest: () => req }) } as any;
    expect(guard.canActivate(c)).toBe(true);
    expect(req.customer).toEqual({ id: sub });
  });

  it('rejects an employee-style token that has NO aud claim', () => {
    const token = jwt.sign({ sub, role: 'cashier' }, SECRET, { expiresIn: '15m' }); // no audience
    expect(() => guard.canActivate(ctx(`Bearer ${token}`))).toThrow(UnauthorizedException);
  });

  it('rejects a token whose aud is a different audience (e.g. employee app)', () => {
    const token = jwt.sign({ sub }, SECRET, { audience: 'employee-app', expiresIn: '15m' });
    expect(() => guard.canActivate(ctx(`Bearer ${token}`))).toThrow(UnauthorizedException);
  });

  it('rejects a token signed with the wrong secret', () => {
    const token = jwt.sign({ sub }, 'some-other-secret-also-32-chars-long-x', { audience: 'mobile-app', expiresIn: '15m' });
    expect(() => guard.canActivate(ctx(`Bearer ${token}`))).toThrow(UnauthorizedException);
  });

  it('rejects an alg=none (unsigned) token', () => {
    const token = jwt.sign({ sub, aud: 'mobile-app' }, '', { algorithm: 'none' as any });
    expect(() => guard.canActivate(ctx(`Bearer ${token}`))).toThrow(UnauthorizedException);
  });

  it('rejects a missing / malformed Authorization header', () => {
    expect(() => guard.canActivate(ctx(undefined))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx('Token xyz'))).toThrow(UnauthorizedException);
  });
});
