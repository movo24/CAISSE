/**
 * Étage 1 — ReadOnlyGuard (INV-1, structural): the cockpit API is GET-only. A
 * non-GET method is rejected with 405 regardless of any handler — so no mutating
 * route can ever serve a mutation.
 */
import { ExecutionContext, HttpException } from '@nestjs/common';
import { ReadOnlyGuard } from '../src/modules/mobile-read-api/read-only.guard';

const ctxFor = (method: string): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => ({ method }) }) } as unknown as ExecutionContext);

describe('ReadOnlyGuard — INV-1 GET-only', () => {
  const guard = new ReadOnlyGuard();

  it('allows GET', () => {
    expect(guard.canActivate(ctxFor('GET'))).toBe(true);
    expect(guard.canActivate(ctxFor('get'))).toBe(true); // case-insensitive
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'])('rejects %s with 405', (m) => {
    expect(() => guard.canActivate(ctxFor(m))).toThrow(HttpException);
    try {
      guard.canActivate(ctxFor(m));
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(405);
    }
  });
});
