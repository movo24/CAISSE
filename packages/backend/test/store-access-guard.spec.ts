/**
 * Lot 3 — StoreAccessGuard (contrôle serveur obligatoire du périmètre, spec §5).
 *
 * Vérifie : bypass admin, mapping des codes 403 (FORBIDDEN / ACCOUNT_SUSPENDED /
 * ACCESS_EXPIRED), impossibilité de contourner via URL/query, périmètre respecté en
 * comparaison multi-magasins (§18-17/18), et passage de la permission demandée.
 */
import { ForbiddenException } from '@nestjs/common';
import { StoreAccessGuard } from '../src/modules/pilotage-access/store-access.guard';

const makeCtx = (req: any) =>
  ({
    getHandler: () => 'h',
    getClass: () => 'c',
    switchToHttp: () => ({ getRequest: () => req }),
  }) as any;

const guardWith = (meta: any, resolveImpl: any) => {
  const reflector = { getAllAndOverride: () => meta } as any;
  const access = { resolveEffectiveAccess: jest.fn(resolveImpl) } as any;
  return { guard: new StoreAccessGuard(reflector, access), access };
};

const CERGY = 'store-cergy';
const EVRY = 'store-evry';

describe('Lot 3 — StoreAccessGuard', () => {
  it('endpoint non gardé (pas de metadata) → passe', async () => {
    const { guard } = guardWith(undefined, async () => ({ allowed: true, globalScope: false }));
    expect(await guard.canActivate(makeCtx({ user: { employeeId: 'e' } }))).toBe(true);
  });

  it('non authentifié → 403 FORBIDDEN', async () => {
    const { guard } = guardWith({}, async () => ({ allowed: true, globalScope: false }));
    await expect(guard.canActivate(makeCtx({}))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('admin POS → périmètre global, resolver non appelé', async () => {
    const { guard, access } = guardWith({}, async () => ({ allowed: true, globalScope: false }));
    const req: any = { user: { employeeId: 'e', role: 'admin' }, params: { storeId: EVRY } };
    expect(await guard.canActivate(makeCtx(req))).toBe(true);
    expect(req.accessScope).toEqual({ global: true, storeIds: [] });
    expect(access.resolveEffectiveAccess).not.toHaveBeenCalled();
  });

  it('§18-1 — Cergy autorisé → passe', async () => {
    const { guard } = guardWith({}, async () => ({ allowed: true, globalScope: false }));
    const req = { user: { employeeId: 'e', role: 'manager' }, params: { storeId: CERGY } };
    expect(await guard.canActivate(makeCtx(req))).toBe(true);
  });

  it('§18-3 — Évry refusé → 403 code FORBIDDEN (reason STORE_NOT_IN_SCOPE)', async () => {
    const { guard } = guardWith({}, async () => ({ allowed: false, reason: 'STORE_NOT_IN_SCOPE', globalScope: false }));
    const req = { user: { employeeId: 'e', role: 'manager' }, params: { storeId: EVRY } };
    try {
      await guard.canActivate(makeCtx(req));
      throw new Error('should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({ code: 'FORBIDDEN', reason: 'STORE_NOT_IN_SCOPE', storeId: EVRY });
    }
  });

  it('suspendu → code ACCOUNT_SUSPENDED ; expiré → code ACCESS_EXPIRED', async () => {
    const susp = guardWith({}, async () => ({ allowed: false, reason: 'ACCOUNT_SUSPENDED', globalScope: false }));
    await expect(
      susp.guard.canActivate(makeCtx({ user: { employeeId: 'e', role: 'manager' }, query: { storeId: CERGY } })),
    ).rejects.toMatchObject({ response: { code: 'ACCOUNT_SUSPENDED' } });

    const exp = guardWith({}, async () => ({ allowed: false, reason: 'ACCESS_EXPIRED', globalScope: false }));
    await expect(
      exp.guard.canActivate(makeCtx({ user: { employeeId: 'e', role: 'manager' }, query: { storeId: CERGY } })),
    ).rejects.toMatchObject({ response: { code: 'ACCESS_EXPIRED' } });
  });

  it('§18-18 — comparaison multi-magasins : un seul magasin hors périmètre → 403', async () => {
    // Cergy autorisé, Évry non → l'ensemble échoue.
    const { guard, access } = guardWith({}, async ({ storeId }: any) => ({
      allowed: storeId === CERGY,
      reason: storeId === CERGY ? undefined : 'STORE_NOT_IN_SCOPE',
      globalScope: false,
    }));
    const req = { user: { employeeId: 'e', role: 'manager' }, query: { storeIds: `${CERGY},${EVRY}` } };
    await expect(guard.canActivate(makeCtx(req))).rejects.toBeInstanceOf(ForbiddenException);
    expect(access.resolveEffectiveAccess).toHaveBeenCalledTimes(2);
  });

  it('la permission demandée est transmise au résolveur', async () => {
    const { guard, access } = guardWith({ permission: 'can_view_financials' }, async () => ({ allowed: true, globalScope: false }));
    await guard.canActivate(makeCtx({ user: { employeeId: 'e', role: 'manager' }, params: { storeId: CERGY } }));
    expect(access.resolveEffectiveAccess).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: CERGY, permission: 'can_view_financials', accountActive: true }),
    );
  });
});
