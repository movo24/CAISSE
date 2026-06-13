/**
 * Governance commit 1 — TRUE atomicity of runWithAudit on a REAL Postgres
 * (gated on TEST_DATABASE_URL; skipped otherwise, so the pg-mem suite is
 * unaffected). pg-mem does NOT honour transaction rollback, so the all-or-
 * nothing guarantee — a mutation can never commit without its chained audit
 * entry, and an audit append failure rolls the mutation back — can only be
 * proven here.
 *
 *   TEST_DATABASE_URL=postgresql://user@localhost:5432/caisse_audit_e2e \
 *     npx jest --forceExit test/store-schedule-audit.pg.spec.ts
 */
import './helpers/env-setup';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { loadAllEntities } from './helpers/pgmem';
import { AuditEntryEntity } from '../src/database/entities/audit-entry.entity';
import { AnalyticsStoreWeeklyHoursEntity } from '../src/database/entities/analytics-store-weekly-hours.entity';
import { AuditService } from '../src/modules/audit/audit.service';

const TEST_DB = process.env.TEST_DATABASE_URL;
const d = TEST_DB ? describe : describe.skip;

d('runWithAudit atomicity (real Postgres)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let audit: AuditService;
  const STORE = uuidv4();
  const ACTOR = uuidv4();
  const params = (action: string) => ({
    storeId: STORE, employeeId: ACTOR, action, entityType: 'store_schedule', entityId: STORE, details: {},
  });

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({ type: 'postgres', url: TEST_DB, entities: loadAllEntities() as any, synchronize: true }),
        TypeOrmModule.forFeature([AuditEntryEntity]),
      ],
    }).compile();
    ds = moduleRef.get(DataSource);
    audit = new AuditService(ds.getRepository(AuditEntryEntity), ds);
  });
  afterAll(async () => {
    await moduleRef?.close();
  });

  it('DECISIVE — the mutation throwing rolls BOTH back: no schedule row, no audit entry', async () => {
    const weekly = ds.getRepository(AnalyticsStoreWeeklyHoursEntity);
    await expect(
      audit.runWithAudit(params('store_hours_updated'), async (m) => {
        // a real partial write, THEN a failure — Postgres must undo the insert
        await m.getRepository(AnalyticsStoreWeeklyHoursEntity).insert({
          storeId: STORE, weekday: 1, openLocal: '09:00', closeLocal: '20:00', isClosed: false, isActive: true,
        });
        throw new Error('mutation failed mid-flight');
      }),
    ).rejects.toThrow('mutation failed');

    expect(await weekly.count({ where: { storeId: STORE } })).toBe(0); // insert rolled back
    expect(await ds.getRepository(AuditEntryEntity).count({ where: { storeId: STORE } })).toBe(0); // no entry
  });

  it('DECISIVE — the audit append failing rolls the MUTATION back (no orphan mutation)', async () => {
    const weekly = ds.getRepository(AnalyticsStoreWeeklyHoursEntity);
    // Force the append to fail by violating audit_entries NOT NULL (employeeId null).
    await expect(
      audit.runWithAudit({ ...params('store_hours_updated'), employeeId: null as any }, async (m) => {
        await m.getRepository(AnalyticsStoreWeeklyHoursEntity).insert({
          storeId: STORE, weekday: 2, openLocal: '09:00', closeLocal: '20:00', isClosed: false, isActive: true,
        });
      }),
    ).rejects.toThrow();

    expect(await weekly.count({ where: { storeId: STORE } })).toBe(0); // mutation rolled back with the failed append
  });

  it('a successful runWithAudit commits BOTH and the chain verifies', async () => {
    await audit.runWithAudit(params('store_hours_updated'), async (m) => {
      await m.getRepository(AnalyticsStoreWeeklyHoursEntity).insert({
        storeId: STORE, weekday: 3, openLocal: '09:00', closeLocal: '20:00', isClosed: false, isActive: true,
      });
    });
    expect(await ds.getRepository(AnalyticsStoreWeeklyHoursEntity).count({ where: { storeId: STORE } })).toBe(1);
    expect(await ds.getRepository(AuditEntryEntity).count({ where: { storeId: STORE } })).toBe(1);
    expect((await audit.verifyChain(STORE)).valid).toBe(true);
  });
});
