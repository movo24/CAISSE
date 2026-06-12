/**
 * Étage 0 — POS projection refresh (INV-4). Seeds POS sources (completed + voided
 * sales, a credit_note, pos_sessions) and asserts the refresh job CONSOLIDATES them
 * into analytics_store_daily / _sessions / _registry (idempotently), copying the POS
 * figures rather than recomputing them.
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { OrganizationEntity } from '../src/database/entities/organization.entity';
import { StoreEntity } from '../src/database/entities/store.entity';
import { SaleEntity } from '../src/database/entities/sale.entity';
import { CreditNoteEntity } from '../src/database/entities/credit-note.entity';
import { PosSessionEntity } from '../src/database/entities/pos-session.entity';
import { AnalyticsStoreDailyEntity } from '../src/database/entities/analytics-store-daily.entity';
import { AnalyticsStoreSessionsEntity } from '../src/database/entities/analytics-store-sessions.entity';
import { AnalyticsStoreRegistryEntity } from '../src/database/entities/analytics-store-registry.entity';
import { PosProjectionRefreshService } from '../src/modules/analytics-projection/pos-projection-refresh.service';

describe('Étage 0 — POS projection refresh (INV-4)', () => {
  let ds: DataSource;
  let svc: PosProjectionRefreshService;
  const ORG = uuidv4();
  const STORE = uuidv4();
  const EMP = uuidv4();

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();

    await ds.getRepository(OrganizationEntity).save({ id: ORG, name: 'Wesley' } as any);
    await ds.getRepository(StoreEntity).save({
      id: STORE, name: 'Grand Littoral B43', organizationId: ORG, isActive: true, currencyCode: 'EUR',
    } as any);

    const sale = (over: any) => ({
      id: uuidv4(), storeId: STORE, employeeId: EMP, status: 'completed',
      subtotalMinorUnits: 0, discountTotalMinorUnits: 0, taxTotalMinorUnits: 0, totalMinorUnits: 0,
      currencyCode: 'EUR', ticketNumber: `T-${uuidv4().slice(0, 6)}`, ...over,
    });
    await ds.getRepository(SaleEntity).save([
      sale({ totalMinorUnits: 1000, status: 'completed', discountTotalMinorUnits: 150 }),
      sale({ totalMinorUnits: 500, status: 'completed', discountTotalMinorUnits: 50 }),
      sale({ totalMinorUnits: 300, status: 'voided', discountTotalMinorUnits: 999 }), // voided → excluded from discounts too
    ] as any);
    await ds.getRepository(CreditNoteEntity).save([
      { id: uuidv4(), storeId: STORE, code: `AV-${uuidv4().slice(0, 6)}`, origin: 'return', type: 'store_credit', status: 'active', totalMinorUnits: 200, remainingMinorUnits: 200, currencyCode: 'EUR', employeeId: EMP },
    ] as any);
    await ds.getRepository(PosSessionEntity).save([
      { id: uuidv4(), storeId: STORE, employeeId: EMP, employeeName: 'Alice', employeeRole: 'cashier', terminalId: 'TERM-A', isActive: true },
      { id: uuidv4(), storeId: STORE, employeeId: EMP, employeeName: 'Alice', employeeRole: 'cashier', terminalId: 'TERM-B', isActive: true },
      { id: uuidv4(), storeId: STORE, employeeId: EMP, employeeName: 'Alice', employeeRole: 'cashier', terminalId: 'TERM-A', isActive: false }, // closed → excluded
    ] as any);

    svc = new PosProjectionRefreshService(
      ds.getRepository(StoreEntity),
      ds.getRepository(SaleEntity),
      ds.getRepository(CreditNoteEntity),
      ds.getRepository(PosSessionEntity),
      ds.getRepository(AnalyticsStoreDailyEntity),
      ds.getRepository(AnalyticsStoreSessionsEntity),
      ds.getRepository(AnalyticsStoreRegistryEntity),
    );
    await svc.refreshAll(new Date());
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('daily summary: CA / tx / voids / returns / net consolidated from the POS sources', async () => {
    const d = await ds.getRepository(AnalyticsStoreDailyEntity).findOne({ where: { storeId: STORE } });
    expect(d).toBeTruthy();
    expect(d!.caBrutMinor).toBe(1500); // 1000 + 500 completed
    expect(d!.txCount).toBe(2);
    expect(d!.voidCount).toBe(1);
    expect(d!.voidAmountMinor).toBe(300);
    expect(d!.returnsAmountMinor).toBe(200);
    expect(d!.discountTotalMinor).toBe(200); // 150 + 50 (the voided sale's 999 excluded)
    expect(d!.netMinor).toBe(1300); // 1500 − 200
    expect(d!.computedAt).toBeTruthy();
  });

  it('sessions snapshot: open sessions + distinct active terminals (closed excluded)', async () => {
    const s = await ds.getRepository(AnalyticsStoreSessionsEntity).findOne({ where: { storeId: STORE } });
    expect(s!.openSessions).toBe(2);
    expect(s!.activeTerminals).toBe(2); // TERM-A, TERM-B
  });

  it('registry projection: store meta available without reading the source `stores`', async () => {
    const r = await ds.getRepository(AnalyticsStoreRegistryEntity).findOne({ where: { storeId: STORE } });
    expect(r!.name).toBe('Grand Littoral B43');
    expect(r!.organizationId).toBe(ORG);
    expect(r!.isActive).toBe(true);
  });

  it('idempotent: a second refresh keeps exactly one row per store', async () => {
    await svc.refreshAll(new Date());
    expect(await ds.getRepository(AnalyticsStoreDailyEntity).count({ where: { storeId: STORE } })).toBe(1);
    expect(await ds.getRepository(AnalyticsStoreSessionsEntity).count({ where: { storeId: STORE } })).toBe(1);
    expect(await ds.getRepository(AnalyticsStoreRegistryEntity).count({ where: { storeId: STORE } })).toBe(1);
  });

  it('idempotent (CONTENT): re-running on the SAME sources reproduces identical proj content + monotonic computed_at', async () => {
    const dailyRepo = ds.getRepository(AnalyticsStoreDailyEntity);
    const sessRepo = ds.getRepository(AnalyticsStoreSessionsEntity);

    const before = await dailyRepo.findOne({ where: { storeId: STORE } });
    const beforeSess = await sessRepo.findOne({ where: { storeId: STORE } });
    const t1 = new Date(before!.computedAt).getTime();

    // Re-run with a LATER clock, SAME source data.
    await svc.refreshAll(new Date(t1 + 60_000));

    const after = await dailyRepo.findOne({ where: { storeId: STORE } });
    const afterSess = await sessRepo.findOne({ where: { storeId: STORE } });

    // No duplicate.
    expect(await dailyRepo.count({ where: { storeId: STORE } })).toBe(1);

    // STRICT content equality on every derived field (id churns on delete+insert,
    // computed_at may rise — both excluded). Catches an upsert that overwrites with
    // different values (a count-only test would miss it).
    const strip = (r: any) => ({ ...r, id: undefined, computedAt: undefined });
    expect(strip(after)).toEqual(strip(before));
    expect(strip(afterSess)).toEqual(strip(beforeSess));

    // computed_at is monotonic — it does NOT go backward.
    expect(new Date(after!.computedAt).getTime()).toBeGreaterThanOrEqual(t1);
  });

  it('hard guard (real flow) — a refresh with an OLDER clock leaves the row unchanged', async () => {
    // The WARNING-on-reject is pinned deterministically in projection-upsert.util.spec.ts
    // (mock logger). Here we prove the END-TO-END behaviour: a stale clock does not move
    // the row back. If the guard did NOT reject, computed_at would drop to the stale value.
    const daily = ds.getRepository(AnalyticsStoreDailyEntity);
    const current = await daily.findOne({ where: { storeId: STORE } });
    const fresh = new Date(current!.computedAt).getTime();

    await svc.refreshAll(new Date(fresh - 60_000)); // STALE clock

    const after = await daily.findOne({ where: { storeId: STORE } });
    expect(new Date(after!.computedAt).getTime()).toBe(fresh); // kept the fresher row
    expect(await daily.count({ where: { storeId: STORE } })).toBe(1); // still one row
  });
});
