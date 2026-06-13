/**
 * Étage 2 (clôture) — GET /mobile/v1/alerts (collection, silently scoped). The
 * cockpit sees the scope's alert FACTS (today + the previous business day, since a
 * fact may belong to a closed day, e.g. sales_drop); out-of-scope stores' alerts
 * are shaped out. computed_at carried on every row.
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { OrganizationEntity } from '../src/database/entities/organization.entity';
import { StoreEntity } from '../src/database/entities/store.entity';
import { EmployeeStoreAccessEntity } from '../src/database/entities/employee-store-access.entity';
import { AnalyticsStoreRegistryEntity } from '../src/database/entities/analytics-store-registry.entity';
import { AnalyticsStoreClockEntity } from '../src/database/entities/analytics-store-clock.entity';
import { AnalyticsStoreDailyEntity } from '../src/database/entities/analytics-store-daily.entity';
import { AnalyticsStoreSessionsEntity } from '../src/database/entities/analytics-store-sessions.entity';
import { AnalyticsStorePresenceEntity } from '../src/database/entities/analytics-store-presence.entity';
import { AnalyticsStoreStockEntity } from '../src/database/entities/analytics-store-stock.entity';
import { AnalyticsAlertEntity } from '../src/database/entities/analytics-alert.entity';
import { AnalyticsStoreTargetEntity } from '../src/database/entities/analytics-store-target.entity';
import { StoreScopeResolverService } from '../src/modules/analytics-projection/store-scope-resolver.service';
import { MobileReadService } from '../src/modules/mobile-read-api/mobile-read.service';
import { MobileReadController } from '../src/modules/mobile-read-api/mobile-read.controller';

describe('Étage 2 — GET /mobile/v1/alerts (scoped collection)', () => {
  let ds: DataSource;
  let controller: MobileReadController;
  const ORG_A = uuidv4();
  const ORG_B = uuidv4();
  const S1 = uuidv4();
  const S4 = uuidv4();
  const MANAGER = uuidv4();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  const lastWeek = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    await ds.getRepository(OrganizationEntity).save([{ id: ORG_A, name: 'Wesley' }, { id: ORG_B, name: 'Other' }] as any);
    await ds.getRepository(StoreEntity).save([
      { id: S1, name: 'B43', organizationId: ORG_A, isActive: true, currencyCode: 'EUR' },
      { id: S4, name: 'Évry', organizationId: ORG_B, isActive: true, currencyCode: 'EUR' },
    ] as any);
    await ds.getRepository(AnalyticsAlertEntity).save([
      { storeId: S1, rule: 'void_rate', businessDay: today, thresholdBand: 'warning', payload: { rate: 0.12 }, computedAt: now },
      { storeId: S1, rule: 'sales_drop', businessDay: yesterday, thresholdBand: 'drop', payload: { observedDropPct: 0.4 }, computedAt: now },
      { storeId: S1, rule: 'stock_low', businessDay: lastWeek, thresholdBand: 'rupture', payload: {}, computedAt: now }, // outside the window
      { storeId: S4, rule: 'void_rate', businessDay: today, thresholdBand: 'critical', payload: {}, computedAt: now }, // out of scope
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
      ds.getRepository(AnalyticsStoreClockEntity),
    );
    controller = new MobileReadController(resolver, service);
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('a manager sees ONLY their scope’s alerts, within today + the previous day', async () => {
    const rows = await controller.alerts({ user: { employeeId: MANAGER, storeId: S1, role: 'manager' } });
    expect(rows.map((r) => r.rule).sort()).toEqual(['sales_drop', 'void_rate']);
    expect(rows.every((r) => r.storeId === S1)).toBe(true); // S4's alert shaped out (silent collection rule)
    expect(rows.find((r) => r.rule === 'stock_low')).toBeUndefined(); // last week = outside the window
  });

  it('every alert row carries its payload + computed_at (freshness of the source fact)', async () => {
    const rows = await controller.alerts({ user: { employeeId: MANAGER, storeId: S1, role: 'manager' } });
    expect(rows.every((r) => !!r.computedAt)).toBe(true);
    expect(rows.find((r) => r.rule === 'void_rate')!.payload).toMatchObject({ rate: 0.12 });
  });
});
