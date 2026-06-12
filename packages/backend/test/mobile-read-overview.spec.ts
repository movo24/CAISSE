/**
 * Étage 1 — GET /mobile/v1/dashboard/overview (scoped aggregate). Sums analytics.*
 * across the principal's scope only (other orgs excluded), exposes the OLDEST
 * computed_at as the honest freshness.
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
import { AnalyticsAlertEntity } from '../src/database/entities/analytics-alert.entity';
import { AnalyticsStoreTargetEntity } from '../src/database/entities/analytics-store-target.entity';
import { StoreScopeResolverService } from '../src/modules/analytics-projection/store-scope-resolver.service';
import { MobileReadService } from '../src/modules/mobile-read-api/mobile-read.service';
import { MobileReadController } from '../src/modules/mobile-read-api/mobile-read.controller';

describe('Étage 1 — GET /mobile/v1/dashboard/overview (scoped aggregate)', () => {
  let ds: DataSource;
  let controller: MobileReadController;
  const ORG_A = uuidv4();
  const ORG_B = uuidv4();
  const S1 = uuidv4();
  const S2 = uuidv4();
  const S4 = uuidv4();
  const ADMIN = uuidv4();
  const today = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    await ds.getRepository(OrganizationEntity).save([{ id: ORG_A, name: 'Wesley' }, { id: ORG_B, name: 'Other' }] as any);
    await ds.getRepository(StoreEntity).save([
      { id: S1, name: 'B43', organizationId: ORG_A, isActive: true, currencyCode: 'EUR' },
      { id: S2, name: 'Cergy', organizationId: ORG_A, isActive: true, currencyCode: 'EUR' },
      { id: S4, name: 'Évry', organizationId: ORG_B, isActive: true, currencyCode: 'EUR' },
    ] as any);

    const old = new Date('2026-06-12T08:00:00Z');
    const newer = new Date('2026-06-12T09:00:00Z');
    await ds.getRepository(AnalyticsStoreRegistryEntity).save([
      { storeId: S1, name: 'B43', organizationId: ORG_A, unitId: null, isActive: true, computedAt: newer },
      { storeId: S2, name: 'Cergy', organizationId: ORG_A, unitId: null, isActive: true, computedAt: newer },
      { storeId: S4, name: 'Évry', organizationId: ORG_B, unitId: null, isActive: true, computedAt: newer },
    ] as any);
    await ds.getRepository(AnalyticsStoreDailyEntity).save([
      { storeId: S1, businessDay: today, caBrutMinor: 1500, txCount: 10, voidCount: 1, voidAmountMinor: 50, returnsAmountMinor: 200, netMinor: 1000, computedAt: old }, // oldest
      { storeId: S2, businessDay: today, caBrutMinor: 600, txCount: 5, voidCount: 0, voidAmountMinor: 0, returnsAmountMinor: 100, netMinor: 500, computedAt: newer },
      { storeId: S4, businessDay: today, caBrutMinor: 9999, txCount: 99, voidCount: 9, voidAmountMinor: 9, returnsAmountMinor: 9, netMinor: 9999, computedAt: newer }, // out of scope
    ] as any);
    await ds.getRepository(AnalyticsStoreSessionsEntity).save([
      { storeId: S1, openSessions: 2, activeTerminals: 3, computedAt: newer },
      { storeId: S2, openSessions: 1, activeTerminals: 1, computedAt: newer },
      { storeId: S4, openSessions: 9, activeTerminals: 9, computedAt: newer },
    ] as any);
    await ds.getRepository(AnalyticsStorePresenceEntity).save([
      { storeId: S1, presentCount: 3, expectedCount: 4, computedAt: newer },
      { storeId: S2, presentCount: 2, expectedCount: 2, computedAt: newer },
    ] as any);
    await ds.getRepository(AnalyticsStoreStockEntity).save([
      { storeId: S1, ruptureCount: 1, lowStockCount: 2, computedAt: newer },
      { storeId: S2, ruptureCount: 0, lowStockCount: 1, computedAt: newer },
    ] as any);

    const resolver = new StoreScopeResolverService(ds.getRepository(StoreEntity), ds.getRepository(EmployeeStoreAccessEntity));
    const service = new MobileReadService(
      ds.getRepository(AnalyticsStoreRegistryEntity),
      ds.getRepository(AnalyticsStoreDailyEntity),
      ds.getRepository(AnalyticsStoreSessionsEntity),
      ds.getRepository(AnalyticsStorePresenceEntity),
      ds.getRepository(AnalyticsStoreStockEntity),
      ds.getRepository(AnalyticsAlertEntity),
      ds.getRepository(AnalyticsStoreTargetEntity),
    );
    controller = new MobileReadController(resolver, service);
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('aggregates ONLY the scoped stores (org A), excluding the other org (S4)', async () => {
    const o = await controller.overview({ user: { employeeId: ADMIN, storeId: S1, role: 'admin' } });
    expect(o.scope.storeCount).toBe(2);
    expect(o.sales.caNetMinor).toBe(1500); // 1000 + 500 (NOT 9999)
    expect(o.sales.caBrutMinor).toBe(2100); // 1500 + 600
    expect(o.sales.txCount).toBe(15);
    expect(o.sales.voidCount).toBe(1);
    expect(o.sales.returnsAmountMinor).toBe(300);
    expect(o.sessions.openSessions).toBe(3);
    expect(o.sessions.activeTerminals).toBe(4);
    expect(o.presence.presentCount).toBe(5);
    expect(o.stock.ruptureCount).toBe(1);
    expect(o.stock.lowStockCount).toBe(3);
  });

  it('exposes the OLDEST contributing computed_at as the honest freshness', async () => {
    const o = await controller.overview({ user: { employeeId: ADMIN, storeId: S1, role: 'admin' } });
    expect(o.computedAt).toBeTruthy();
    expect(new Date(o.computedAt!).getTime()).toBe(new Date('2026-06-12T08:00:00Z').getTime());
  });

  it('NO target datum → targetMinor/targetReachedPct are NULL (honest absence, nothing fabricated)', async () => {
    const o = await controller.overview({ user: { employeeId: ADMIN, storeId: S1, role: 'admin' } });
    expect(o.sales.targetMinor).toBeNull();
    expect(o.sales.targetReachedPct).toBeNull();
  });

  it('WITH a datum in the SHARED store_targets table → target + %atteint (one source, two readers)', async () => {
    await ds.getRepository(AnalyticsStoreTargetEntity).save({ storeId: S1, dailyTargetMinor: 3000, isActive: true } as any);
    const o = await controller.overview({ user: { employeeId: ADMIN, storeId: S1, role: 'admin' } });
    expect(o.sales.targetMinor).toBe(3000);
    expect(o.sales.targetReachedPct).toBe(70); // caBrut 2100 / 3000
  });
});
