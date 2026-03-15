import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard, ROLES_KEY } from './roles.guard';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  function createMockContext(role: string, requiredRoles?: string[]): ExecutionContext {
    const handler = jest.fn();
    const classRef = jest.fn();

    if (requiredRoles) {
      Reflect.defineMetadata(ROLES_KEY, requiredRoles, handler);
    }

    return {
      getHandler: () => handler,
      getClass: () => classRef,
      switchToHttp: () => ({
        getRequest: () => ({
          user: { employeeId: 'emp-1', storeId: 'store-1', role },
        }),
      }),
    } as any;
  }

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('should allow when no roles are required', () => {
    const ctx = createMockContext('cashier');
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should allow admin for admin-only endpoint', () => {
    const ctx = createMockContext('admin', ['admin']);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should allow manager for admin/manager endpoint', () => {
    const ctx = createMockContext('manager', ['admin', 'manager']);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should deny cashier for admin-only endpoint', () => {
    const ctx = createMockContext('cashier', ['admin']);
    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('should deny cashier for admin/manager endpoint', () => {
    const ctx = createMockContext('cashier', ['admin', 'manager']);
    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('should allow cashier when cashier is in required roles', () => {
    const ctx = createMockContext('cashier', ['cashier', 'manager', 'admin']);
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
