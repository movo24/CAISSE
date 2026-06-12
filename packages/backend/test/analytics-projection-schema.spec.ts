/**
 * Étage 0 — analytics projection schema (INV-2 read model). Validates that the
 * five `analytics_*` read-model tables exist, are store-scoped, carry computed_at,
 * and that the per-(store, day) summary is unique. Runs against pg-mem (public
 * schema, prefixed tables).
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { AnalyticsStoreDailyEntity } from '../src/database/entities/analytics-store-daily.entity';
import { AnalyticsStoreSessionsEntity } from '../src/database/entities/analytics-store-sessions.entity';
import { AnalyticsStorePresenceEntity } from '../src/database/entities/analytics-store-presence.entity';
import { AnalyticsStoreStockEntity } from '../src/database/entities/analytics-store-stock.entity';
import { AnalyticsStoreRegistryEntity } from '../src/database/entities/analytics-store-registry.entity';

describe('Étage 0 — analytics projection schema (INV-2)', () => {
  let ds: DataSource;
  const STORE = uuidv4();

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('store_daily: persists a (store, day) POS summary with store_id + computed_at', async () => {
    const repo = ds.getRepository(AnalyticsStoreDailyEntity);
    await repo.save({
      storeId: STORE,
      businessDay: '2026-06-12',
      caBrutMinor: 150000,
      txCount: 42,
      voidCount: 1,
      voidAmountMinor: 500,
      returnsAmountMinor: 1000,
      netMinor: 149000,
      byTender: { cash: 50000, card: 100000 },
      computedAt: new Date(),
    } as any);

    const row = await repo.findOne({ where: { storeId: STORE } });
    expect(row).toBeTruthy();
    expect(row!.storeId).toBe(STORE);
    expect(row!.computedAt).toBeTruthy();
    expect(row!.netMinor).toBe(149000);
    expect(row!.byTender).toEqual({ cash: 50000, card: 100000 });
  });

  it('store_daily: (store_id, business_day) is unique — one summary per store/day', async () => {
    const repo = ds.getRepository(AnalyticsStoreDailyEntity);
    await expect(
      repo.save({
        storeId: STORE,
        businessDay: '2026-06-12',
        caBrutMinor: 1,
        computedAt: new Date(),
      } as any),
    ).rejects.toBeTruthy();
  });

  it('the 4 snapshot projections each persist a store-scoped row with computed_at', async () => {
    const now = new Date();
    await ds.getRepository(AnalyticsStoreSessionsEntity).save({ storeId: STORE, openSessions: 2, activeTerminals: 3, computedAt: now } as any);
    await ds.getRepository(AnalyticsStorePresenceEntity).save({ storeId: STORE, presentCount: 4, expectedCount: 5, computedAt: now } as any);
    await ds.getRepository(AnalyticsStoreStockEntity).save({ storeId: STORE, ruptureCount: 1, lowStockCount: 7, computedAt: now } as any);
    await ds.getRepository(AnalyticsStoreRegistryEntity).save({ storeId: STORE, name: 'Grand Littoral B43', organizationId: uuidv4(), unitId: null, isActive: true, computedAt: now } as any);

    expect((await ds.getRepository(AnalyticsStoreSessionsEntity).findOne({ where: { storeId: STORE } }))!.activeTerminals).toBe(3);
    expect((await ds.getRepository(AnalyticsStorePresenceEntity).findOne({ where: { storeId: STORE } }))!.presentCount).toBe(4);
    expect((await ds.getRepository(AnalyticsStoreStockEntity).findOne({ where: { storeId: STORE } }))!.ruptureCount).toBe(1);
    expect((await ds.getRepository(AnalyticsStoreRegistryEntity).findOne({ where: { storeId: STORE } }))!.name).toBe('Grand Littoral B43');
  });
});
