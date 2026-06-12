/**
 * Étage 1 — GET /mobile/v1/stores (collection, silently scoped). A manager sees only
 * the stores in their scope from analytics.store_registry; out-of-scope stores are
 * shaped out of the result (no error). computed_at is exposed.
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { OrganizationEntity } from '../src/database/entities/organization.entity';
import { StoreEntity } from '../src/database/entities/store.entity';
import { EmployeeStoreAccessEntity } from '../src/database/entities/employee-store-access.entity';
import { AnalyticsStoreRegistryEntity } from '../src/database/entities/analytics-store-registry.entity';
import { AnalyticsStoreDailyEntity } from '../src/database/entities/analytics-store-daily.entity';
import { AnalyticsStoreSessionsEntity } from '../src/database/entities/analytics-store-sessions.entity';
import { AnalyticsStorePresenceEntity } from '../src/database/entities/analytics-store-presence.entity';
import { AnalyticsStoreStockEntity } from '../src/database/entities/analytics-store-stock.entity';
import { StoreScopeResolverService } from '../src/modules/analytics-projection/store-scope-resolver.service';
import { MobileReadService } from '../src/modules/mobile-read-api/mobile-read.service';
import { MobileReadController } from '../src/modules/mobile-read-api/mobile-read.controller';

describe('Étage 1 — GET /mobile/v1/stores (scoped collection)', () => {
  let ds: DataSource;
  let controller: MobileReadController;
  const ORG_A = uuidv4();
  const ORG_B = uuidv4();
  const S1 = uuidv4();
  const S2 = uuidv4();
  const S4 = uuidv4();
  const MANAGER = uuidv4();

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();

    await ds.getRepository(OrganizationEntity).save([{ id: ORG_A, name: 'Wesley' }, { id: ORG_B, name: 'Other' }] as any);
    await ds.getRepository(StoreEntity).save([
      { id: S1, name: 'Grand Littoral B43', organizationId: ORG_A, isActive: true, currencyCode: 'EUR' },
      { id: S2, name: 'Cergy', organizationId: ORG_A, isActive: true, currencyCode: 'EUR' },
      { id: S4, name: 'Évry (other org)', organizationId: ORG_B, isActive: true, currencyCode: 'EUR' },
    ] as any);
    await ds.getRepository(EmployeeStoreAccessEntity).save([{ employeeId: MANAGER, storeId: S2, role: 'active' }] as any);

    const now = new Date();
    await ds.getRepository(AnalyticsStoreRegistryEntity).save([
      { storeId: S1, name: 'Grand Littoral B43', organizationId: ORG_A, unitId: null, isActive: true, computedAt: now },
      { storeId: S2, name: 'Cergy', organizationId: ORG_A, unitId: null, isActive: true, computedAt: now },
      { storeId: S4, name: 'Évry', organizationId: ORG_B, unitId: null, isActive: true, computedAt: now },
    ] as any);

    const resolver = new StoreScopeResolverService(ds.getRepository(StoreEntity), ds.getRepository(EmployeeStoreAccessEntity));
    const service = new MobileReadService(
      ds.getRepository(AnalyticsStoreRegistryEntity),
      ds.getRepository(AnalyticsStoreDailyEntity),
      ds.getRepository(AnalyticsStoreSessionsEntity),
      ds.getRepository(AnalyticsStorePresenceEntity),
      ds.getRepository(AnalyticsStoreStockEntity),
    );
    controller = new MobileReadController(resolver, service);
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('a manager sees ONLY their scoped stores (home ∪ access), never another org', async () => {
    const rows = await controller.stores({ user: { employeeId: MANAGER, storeId: S1, role: 'manager' } });
    expect(rows.map((r) => r.storeId).sort()).toEqual([S1, S2].sort());
    expect(rows.map((r) => r.storeId)).not.toContain(S4);
  });

  it('each row carries computed_at (freshness)', async () => {
    const rows = await controller.stores({ user: { employeeId: MANAGER, storeId: S1, role: 'manager' } });
    expect(rows.every((r) => !!r.computedAt)).toBe(true);
  });
});
