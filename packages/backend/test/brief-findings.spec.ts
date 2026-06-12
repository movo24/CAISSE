/**
 * Étage 3 — deterministic findings engine. THE decisive test: same inputs →
 * IDENTICAL findings (deep equality across two builds), stable ordering, deltas
 * computed deterministically, computed_at from the data (never the wall clock).
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { AnalyticsStoreDailyEntity } from '../src/database/entities/analytics-store-daily.entity';
import { AnalyticsStoreSessionsEntity } from '../src/database/entities/analytics-store-sessions.entity';
import { AnalyticsStorePresenceEntity } from '../src/database/entities/analytics-store-presence.entity';
import { AnalyticsStoreStockEntity } from '../src/database/entities/analytics-store-stock.entity';
import { AnalyticsStoreRegistryEntity } from '../src/database/entities/analytics-store-registry.entity';
import { AnalyticsAlertEntity } from '../src/database/entities/analytics-alert.entity';
import { AnalyticsStoreTargetEntity } from '../src/database/entities/analytics-store-target.entity';
import { BriefFindingsService } from '../src/modules/ai-brief/brief-findings.service';

const DAY = '2026-06-12';
const PREV = '2026-06-11';
const T1 = new Date('2026-06-12T09:00:00Z');
const T0 = new Date('2026-06-12T08:00:00Z'); // oldest contributing freshness

describe('Étage 3 — brief findings engine (deterministic)', () => {
  let ds: DataSource;
  let svc: BriefFindingsService;
  const SA = uuidv4(); // "Alpha"
  const SB = uuidv4(); // "Beta"

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();

    // Registry inserted in REVERSE name order — output ordering must not depend on it.
    await ds.getRepository(AnalyticsStoreRegistryEntity).save([
      { storeId: SB, name: 'Beta', organizationId: null, unitId: null, isActive: true, computedAt: T1 },
      { storeId: SA, name: 'Alpha', organizationId: null, unitId: null, isActive: true, computedAt: T1 },
    ] as any);
    await ds.getRepository(AnalyticsStoreDailyEntity).save([
      { storeId: SA, businessDay: DAY, caBrutMinor: 12000, netMinor: 11000, txCount: 30, voidCount: 1, voidAmountMinor: 0, returnsAmountMinor: 1000, discountTotalMinor: 500, computedAt: T0 },
      { storeId: SA, businessDay: PREV, caBrutMinor: 10000, netMinor: 10000, txCount: 25, voidCount: 0, voidAmountMinor: 0, returnsAmountMinor: 0, discountTotalMinor: 0, computedAt: T0 },
      { storeId: SB, businessDay: DAY, caBrutMinor: 8000, netMinor: 8000, txCount: 20, voidCount: 0, voidAmountMinor: 0, returnsAmountMinor: 0, discountTotalMinor: 0, computedAt: T1 },
    ] as any);
    await ds.getRepository(AnalyticsStoreSessionsEntity).save([
      { storeId: SA, openSessions: 2, activeTerminals: 2, computedAt: T1 },
      { storeId: SB, openSessions: 1, activeTerminals: 1, computedAt: T1 },
    ] as any);
    await ds.getRepository(AnalyticsStorePresenceEntity).save([
      { storeId: SA, presentCount: 3, expectedCount: 4, computedAt: T1 },
    ] as any);
    await ds.getRepository(AnalyticsStoreStockEntity).save([
      { storeId: SA, ruptureCount: 1, lowStockCount: 2, computedAt: T1 },
    ] as any);
    await ds.getRepository(AnalyticsStoreTargetEntity).save([
      { storeId: SA, dailyTargetMinor: 20000, isActive: true },
    ] as any);
    await ds.getRepository(AnalyticsAlertEntity).save([
      { storeId: SA, rule: 'void_rate', businessDay: DAY, thresholdBand: 'warning', payload: {}, computedAt: T1 },
      { storeId: SB, rule: 'stock_low', businessDay: PREV, thresholdBand: 'rupture', payload: {}, computedAt: T1 },
    ] as any);

    svc = new BriefFindingsService(
      ds.getRepository(AnalyticsStoreDailyEntity),
      ds.getRepository(AnalyticsStoreSessionsEntity),
      ds.getRepository(AnalyticsStorePresenceEntity),
      ds.getRepository(AnalyticsStoreStockEntity),
      ds.getRepository(AnalyticsStoreRegistryEntity),
      ds.getRepository(AnalyticsAlertEntity),
      ds.getRepository(AnalyticsStoreTargetEntity),
    );
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('DECISIVE — same inputs → IDENTICAL findings (two builds, deep equality)', async () => {
    const a = await svc.build([SA, SB], DAY);
    const b = await svc.build([SA, SB], DAY);
    expect(b).toEqual(a);
    // and scope order does not change the output either:
    const c = await svc.build([SB, SA], DAY);
    expect(c).toEqual(a);
  });

  it('totals consolidated + target pct from the shared datum; per-store ordering is stable (Alpha then Beta)', async () => {
    const f = await svc.build([SA, SB], DAY);
    expect(f.totals).toMatchObject({
      caBrutMinor: 20000, netMinor: 19000, txCount: 50, voidCount: 1,
      returnsAmountMinor: 1000, discountTotalMinor: 500,
      targetMinor: 20000, targetReachedPct: 100,
      presentCount: 3, openSessions: 3, ruptureCount: 1, alertCount: 2,
    });
    expect(f.stores.map((s) => s.name)).toEqual(['Alpha', 'Beta']);
  });

  it('deltas are deterministic from the projection history (Alpha +20% vs prev day; Beta null)', async () => {
    const f = await svc.build([SA, SB], DAY);
    const alpha = f.stores.find((s) => s.storeId === SA)!;
    const beta = f.stores.find((s) => s.storeId === SB)!;
    expect(alpha.deltaVsPrevDayPct).toBe(20); // (12000-10000)/10000
    expect(beta.deltaVsPrevDayPct).toBeNull(); // no baseline → null, never invented
  });

  it('computed_at = the OLDEST contributing freshness, from the data (not the clock)', async () => {
    const f = await svc.build([SA, SB], DAY);
    expect(f.computedAt).toBe(T0.toISOString());
  });
});
