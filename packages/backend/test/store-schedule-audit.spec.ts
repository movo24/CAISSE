/**
 * Governance chantier, commit 1 — STRUCTURAL atomic audit on admin mutations.
 *
 * The ratified invariant: every admin mutation produces EXACTLY ONE chained
 * audit entry, in the SAME transaction as the mutation — a mutation that
 * commits without its audit entry must be impossible (prevent-at-write applied
 * to the audit). This spec proves the WIRING + chain on pg-mem; the actual
 * ROLLBACK (atomicity under failure) is proven on real Postgres in
 * store-schedule-audit.pg.spec.ts (pg-mem does NOT honour transaction rollback).
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { AnalyticsStoreWeeklyHoursEntity } from '../src/database/entities/analytics-store-weekly-hours.entity';
import { AnalyticsStoreHolidayClosureEntity } from '../src/database/entities/analytics-store-holiday-closure.entity';
import { AuditEntryEntity } from '../src/database/entities/audit-entry.entity';
import { AuditService } from '../src/modules/audit/audit.service';
import { StoreScheduleAdminService, ScheduleDayDto } from '../src/modules/store-schedule/store-schedule-admin.service';

const week = (over: Partial<Record<number, Partial<ScheduleDayDto>>> = {}): ScheduleDayDto[] =>
  [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    dayOfWeek, closed: false, openTime: '09:00', closeTime: '20:00', ...(over[dayOfWeek] ?? {}),
  }));

describe('Commit 1 — admin mutation ↔ chained audit entry (atomic wiring)', () => {
  let ds: DataSource;
  let admin: StoreScheduleAdminService;
  let audit: AuditService;
  const STORE = uuidv4();
  const ACTOR = uuidv4();

  const auditRows = () =>
    ds.getRepository(AuditEntryEntity).find({ where: { storeId: STORE }, order: { timestamp: 'ASC' } });

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    audit = new AuditService(ds.getRepository(AuditEntryEntity), ds);
    admin = new StoreScheduleAdminService(
      ds.getRepository(AnalyticsStoreWeeklyHoursEntity),
      ds.getRepository(AnalyticsStoreHolidayClosureEntity),
      audit,
    );
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('DECISIVE — a successful putWeekly writes the hours AND exactly one attributable audit entry', async () => {
    await admin.putWeekly(STORE, week({ 0: { closed: true, openTime: null, closeTime: null } }), ACTOR);

    expect(await ds.getRepository(AnalyticsStoreWeeklyHoursEntity).count({ where: { storeId: STORE } })).toBe(7);
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      storeId: STORE,
      employeeId: ACTOR, // WHO changed it — attribution
      action: 'store_hours_updated',
      entityType: 'store_schedule',
      entityId: STORE,
    });
    expect((rows[0].details as any).days).toHaveLength(7);
    expect((rows[0].details as any).days[0]).toMatchObject({ d: 0, closed: true });
  });

  it('putHolidays appends a SECOND entry that chains onto the first (previousHash = prior currentHash)', async () => {
    await admin.putHolidays(STORE, ['noel', 'noel'], ACTOR); // dup collapses to one key
    const rows = await auditRows();
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ action: 'store_holidays_updated', employeeId: ACTOR });
    expect((rows[1].details as any).closedHolidayKeys).toEqual(['noel']);
    // the chain links: entry 2's previousHash is entry 1's currentHash
    expect(rows[1].previousHash).toBe(rows[0].currentHash);
    expect((await audit.verifyChain(STORE)).valid).toBe(true);
  });

  it('DECISIVE — a validation failure writes NOTHING (rejected BEFORE the transaction): no audit entry, no schedule change', async () => {
    const before = await auditRows();
    await expect(admin.putWeekly(STORE, week({ 2: { openTime: '20:00', closeTime: '09:00' } }), ACTOR)).rejects.toThrow();
    const after = await auditRows();
    expect(after).toHaveLength(before.length); // no new audit entry
    // the prior good schedule is intact (dimanche still closed from test 1)
    expect(
      (await ds.getRepository(AnalyticsStoreWeeklyHoursEntity).findOne({ where: { storeId: STORE, weekday: 0 } }))?.isClosed,
    ).toBe(true);
  });

  it('NON-store mutations never touch this store’s chain (another store is a separate chain)', async () => {
    const OTHER = uuidv4();
    await admin.putWeekly(OTHER, week(), ACTOR);
    expect((await auditRows())).toHaveLength(2); // STORE chain unchanged
    expect((await audit.verifyChain(OTHER)).valid).toBe(true);
  });
});
