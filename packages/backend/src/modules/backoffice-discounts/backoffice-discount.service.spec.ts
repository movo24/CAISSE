import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { BackofficeDiscountService } from './backoffice-discount.service';

/**
 * POS-054e — back-office discount authorization. Lightweight unit test:
 * the service is instantiated with a mocked AuditService (no Nest/DB graph).
 */
describe('POS-054e BackofficeDiscountService', () => {
  const auditLog = jest.fn().mockResolvedValue(undefined);
  const svc = new BackofficeDiscountService({ log: auditLog } as any);

  const req = (over: Record<string, unknown> = {}) => ({
    storeId: 's1',
    subtotalMinorUnits: 10000,
    discountMinorUnits: 0,
    actorEmployeeId: 'e1',
    actorRole: 'admin',
    ...over,
  });

  beforeEach(() => auditLog.mockClear());

  it('admin 50% with motif = OK and audited as authorized', async () => {
    const r = await svc.authorize(
      req({ discountMinorUnits: 5000, justification: 'Remise négociée siège' }) as any,
    );
    expect(r.discountPct).toBe(50);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'backoffice_discount_authorized' }),
    );
  });

  it('admin 100% with motif = OK', async () => {
    const r = await svc.authorize(
      req({ discountMinorUnits: 10000, justification: 'Avoir total direction' }) as any,
    );
    expect(r.discountPct).toBe(100);
  });

  it('admin > 30% without motif = refused and audited as blocked', async () => {
    await expect(
      svc.authorize(req({ discountMinorUnits: 5000 }) as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'backoffice_discount_blocked' }),
    );
  });

  it('non-admin role = Forbidden (cannot use back-office channel)', async () => {
    await expect(
      svc.authorize(
        req({ actorRole: 'cashier', discountMinorUnits: 5000, justification: 'motif valable' }) as any,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('≤ 30% admin requires no motif = OK', async () => {
    const r = await svc.authorize(req({ discountMinorUnits: 3000 }) as any);
    expect(r.discountPct).toBe(30);
  });
});
