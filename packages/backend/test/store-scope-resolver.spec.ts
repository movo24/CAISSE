/**
 * Étage 0 — store scope resolver (INV-5). owner/admin → whole organization (active
 * stores only), manager → employee_store_access ∪ home store, cashier → own store.
 * Plus the query-layer fail-closed: an empty scope returns zero rows, never "all".
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { StoreEntity } from '../src/database/entities/store.entity';
import { OrganizationEntity } from '../src/database/entities/organization.entity';
import { EmployeeStoreAccessEntity } from '../src/database/entities/employee-store-access.entity';
import { StoreScopeResolverService } from '../src/modules/analytics-projection/store-scope-resolver.service';
import { applyStoreScope } from '../src/modules/analytics-projection/store-scope.util';
import { AnalyticsStoreDailyEntity } from '../src/database/entities/analytics-store-daily.entity';

describe('Étage 0 — store scope resolver (INV-5)', () => {
  let ds: DataSource;
  let svc: StoreScopeResolverService;

  const ORG_A = uuidv4();
  const ORG_B = uuidv4();
  const S1 = uuidv4(); // Grand Littoral B43 (orgA, active, home)
  const S2 = uuidv4(); // orgA, active
  const S3 = uuidv4(); // orgA, INACTIVE
  const S4 = uuidv4(); // orgB
  const MANAGER = uuidv4();

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    await ds.getRepository(OrganizationEntity).save([
      { id: ORG_A, name: 'Wesley' },
      { id: ORG_B, name: 'Other Org' },
    ] as any);
    const stores = ds.getRepository(StoreEntity);
    await stores.save([
      { id: S1, name: 'Grand Littoral B43', organizationId: ORG_A, isActive: true, currencyCode: 'EUR' },
      { id: S2, name: 'Cergy', organizationId: ORG_A, isActive: true, currencyCode: 'EUR' },
      { id: S3, name: 'Qwartz (closed)', organizationId: ORG_A, isActive: false, currencyCode: 'EUR' },
      { id: S4, name: 'Évry (other org)', organizationId: ORG_B, isActive: true, currencyCode: 'EUR' },
    ] as any);
    await ds.getRepository(EmployeeStoreAccessEntity).save([
      { employeeId: MANAGER, storeId: S2, role: 'active' },
    ] as any);
    svc = new StoreScopeResolverService(stores, ds.getRepository(EmployeeStoreAccessEntity));
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('admin → every ACTIVE store of their org (not other orgs, not inactive)', async () => {
    const scope = await svc.resolveAccessibleStoreIds({ employeeId: uuidv4(), storeId: S1, role: 'admin' });
    expect([...scope].sort()).toEqual([S1, S2].sort());
    expect(scope).not.toContain(S3);
    expect(scope).not.toContain(S4);
  });

  it("'owner' is treated as org-wide too (forward-compatible with the cockpit term)", async () => {
    const scope = await svc.resolveAccessibleStoreIds({ employeeId: uuidv4(), storeId: S1, role: 'owner' });
    expect([...scope].sort()).toEqual([S1, S2].sort());
  });

  it('manager → employee_store_access stores ∪ home store', async () => {
    const scope = await svc.resolveAccessibleStoreIds({ employeeId: MANAGER, storeId: S1, role: 'manager' });
    expect([...scope].sort()).toEqual([S1, S2].sort());
    expect(scope).not.toContain(S4);
  });

  it('cashier → own store only (fail-closed minimal scope)', async () => {
    const scope = await svc.resolveAccessibleStoreIds({ employeeId: uuidv4(), storeId: S1, role: 'cashier' });
    expect(scope).toEqual([S1]);
  });

  it('applyStoreScope: empty scope yields ZERO rows (never "all"); a real scope filters', async () => {
    const repo = ds.getRepository(AnalyticsStoreDailyEntity);
    await repo.save({ storeId: S1, businessDay: '2026-06-12', computedAt: new Date() } as any);
    expect(await applyStoreScope(repo.createQueryBuilder('d'), 'd', []).getCount()).toBe(0);
    expect(await applyStoreScope(repo.createQueryBuilder('d'), 'd', [S1]).getCount()).toBe(1);
    expect(await applyStoreScope(repo.createQueryBuilder('d'), 'd', [S4]).getCount()).toBe(0);
  });

  it('INV-5 decisive — a manager FORGING a query for a store outside their access gets ZERO rows (silent filter, no 403)', async () => {
    const daily = ds.getRepository(AnalyticsStoreDailyEntity);
    // S4 (org B) is outside the manager's access (home S1 + access S2). Its data EXISTS:
    await daily.save({ storeId: S4, businessDay: '2026-06-12', computedAt: new Date() } as any);

    const scope = await svc.resolveAccessibleStoreIds({ employeeId: MANAGER, storeId: S1, role: 'manager' });
    expect(scope).not.toContain(S4); // the resolver leaves S4 out

    // The forged read for S4, run under the manager's resolved scope, is SILENTLY
    // empty — at this floor there is no API/403, the WHERE clause just filters it out.
    const forged = await applyStoreScope(daily.createQueryBuilder('d'), 'd', scope)
      .andWhere('d.store_id = :sid', { sid: S4 })
      .getCount();
    expect(forged).toBe(0);
  });
});
