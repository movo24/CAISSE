import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { TenantInterceptor, SKIP_TENANT_KEY } from './tenant.interceptor';

describe('TenantInterceptor', () => {
  let interceptor: TenantInterceptor;
  let reflector: Reflector;

  const mockNext = { handle: () => of('ok') };

  function createMockContext(overrides: {
    user?: any;
    params?: any;
    query?: any;
    body?: any;
    skipHandler?: boolean;
    skipClass?: boolean;
  }): ExecutionContext {
    const request = {
      user: overrides.user ?? { employeeId: 'emp-1', storeId: 'store-1', role: 'cashier' },
      params: overrides.params ?? {},
      query: overrides.query ?? {},
      body: overrides.body ?? {},
    };

    const handler = jest.fn();
    const classRef = jest.fn();

    if (overrides.skipHandler) {
      Reflect.defineMetadata(SKIP_TENANT_KEY, true, handler);
    }
    if (overrides.skipClass) {
      Reflect.defineMetadata(SKIP_TENANT_KEY, true, classRef);
    }

    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => handler,
      getClass: () => classRef,
    } as any;
  }

  beforeEach(() => {
    reflector = new Reflector();
    interceptor = new TenantInterceptor(reflector);
  });

  // ─────────────────────────────────────────────────────────────
  // Skip tenant check
  // ─────────────────────────────────────────────────────────────

  it('should skip tenant check when handler has SkipTenantCheck', (done) => {
    const ctx = createMockContext({ skipHandler: true });
    interceptor.intercept(ctx, mockNext).subscribe({
      next: (val) => {
        expect(val).toBe('ok');
        done();
      },
    });
  });

  it('should skip tenant check when class has SkipTenantCheck', (done) => {
    const ctx = createMockContext({ skipClass: true });
    interceptor.intercept(ctx, mockNext).subscribe({
      next: (val) => {
        expect(val).toBe('ok');
        done();
      },
    });
  });

  it('should skip when no user (public endpoint)', (done) => {
    const ctx = createMockContext({ user: null });
    interceptor.intercept(ctx, mockNext).subscribe({
      next: (val) => {
        expect(val).toBe('ok');
        done();
      },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Route param tenant violation
  // ─────────────────────────────────────────────────────────────

  it('should throw ForbiddenException when route param storeId differs from JWT', () => {
    const ctx = createMockContext({
      params: { storeId: 'other-store' },
    });

    expect(() => {
      interceptor.intercept(ctx, mockNext);
    }).toThrow(ForbiddenException);
  });

  it('should allow when route param storeId matches JWT', (done) => {
    const ctx = createMockContext({
      params: { storeId: 'store-1' },
    });

    interceptor.intercept(ctx, mockNext).subscribe({
      next: (val) => {
        expect(val).toBe('ok');
        done();
      },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Query string tenant violation
  // ─────────────────────────────────────────────────────────────

  it('should throw ForbiddenException when query storeId differs from JWT', () => {
    const ctx = createMockContext({
      query: { storeId: 'other-store' },
    });

    expect(() => {
      interceptor.intercept(ctx, mockNext);
    }).toThrow(ForbiddenException);
  });

  // ─────────────────────────────────────────────────────────────
  // Body tenant violation
  // ─────────────────────────────────────────────────────────────

  it('should throw ForbiddenException when body storeId differs from JWT', () => {
    const ctx = createMockContext({
      body: { storeId: 'other-store' },
    });

    expect(() => {
      interceptor.intercept(ctx, mockNext);
    }).toThrow(ForbiddenException);
  });

  it('should allow when body storeId matches JWT', (done) => {
    const ctx = createMockContext({
      body: { storeId: 'store-1' },
    });

    interceptor.intercept(ctx, mockNext).subscribe({
      next: (val) => {
        expect(val).toBe('ok');
        done();
      },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Auto-injection
  // ─────────────────────────────────────────────────────────────

  it('should NOT inject storeId into body/query (prevents DTO validation conflicts)', (done) => {
    const body = { name: 'Test' };
    const query = {};
    const ctx = createMockContext({ body, query });

    interceptor.intercept(ctx, mockNext).subscribe({
      next: () => {
        // storeId must NOT be injected into body/query — use request.tenantStoreId instead
        expect(body).not.toHaveProperty('storeId');
        expect(query).not.toHaveProperty('storeId');
        done();
      },
    });
  });

  it('should set tenantStoreId on request', (done) => {
    const ctx = createMockContext({});
    const request = ctx.switchToHttp().getRequest();

    interceptor.intercept(ctx, mockNext).subscribe({
      next: () => {
        expect(request.tenantStoreId).toBe('store-1');
        done();
      },
    });
  });
});
