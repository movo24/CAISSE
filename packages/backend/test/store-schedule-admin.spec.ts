/**
 * Schedule chantier commit 6 — the BackOffice write surface. Decisive: a PUT
 * mutates THE source the resolver serves to store_closed_late and the close
 * beat (no duplication); server-side validation is the guarantee (open<close,
 * 7 distinct days, HH:MM, known holiday keys); holiday selection set-replaces.
 */
import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { AnalyticsStoreWeeklyHoursEntity } from '../src/database/entities/analytics-store-weekly-hours.entity';
import { AnalyticsStoreHolidayClosureEntity } from '../src/database/entities/analytics-store-holiday-closure.entity';
import { StoreScheduleService } from '../src/modules/store-schedule/store-schedule.service';
import { StoreScheduleAdminService, ScheduleDayDto } from '../src/modules/store-schedule/store-schedule-admin.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { AuditEntryEntity } from '../src/database/entities/audit-entry.entity';

const week = (over: Partial<Record<number, Partial<ScheduleDayDto>>> = {}): ScheduleDayDto[] =>
  [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    dayOfWeek, closed: false, openTime: '09:00', closeTime: '20:00', ...(over[dayOfWeek] ?? {}),
  }));

describe('Schedule BackOffice write surface (admin router — INV-1 untouched)', () => {
  let ds: DataSource;
  let admin: StoreScheduleAdminService;
  let resolver: StoreScheduleService;
  const STORE = uuidv4();
  const ACTOR = uuidv4();

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    const weekly = ds.getRepository(AnalyticsStoreWeeklyHoursEntity);
    const holidays = ds.getRepository(AnalyticsStoreHolidayClosureEntity);
    const audit = new AuditService(ds.getRepository(AuditEntryEntity), ds);
    admin = new StoreScheduleAdminService(weekly, holidays, audit);
    resolver = new StoreScheduleService(weekly, holidays);
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('DECISIVE — PUT weekly writes THE source the resolver serves (dimanche fermé, samedi nocturne)', async () => {
    await admin.putWeekly(STORE, week({
      0: { closed: true, openTime: null, closeTime: null },
      6: { openTime: '10:00', closeTime: '22:00' },
    }), ACTOR);
    expect(await resolver.resolve(STORE, '2026-06-21')).toBe('closed'); // dimanche
    expect(await resolver.resolve(STORE, '2026-06-20')).toEqual({ openLocal: '10:00', closeLocal: '22:00' }); // samedi
    expect(await resolver.resolve(STORE, '2026-06-15')).toEqual({ openLocal: '09:00', closeLocal: '20:00' }); // lundi
  });

  it('PUT is a set-replace: a second PUT leaves exactly 7 rows', async () => {
    await admin.putWeekly(STORE, week(), ACTOR);
    expect(await ds.getRepository(AnalyticsStoreWeeklyHoursEntity).count({ where: { storeId: STORE } })).toBe(7);
    expect(await resolver.resolve(STORE, '2026-06-21')).toEqual({ openLocal: '09:00', closeLocal: '20:00' }); // dimanche rouvert
  });

  it('ADVERSE — server validation is the guarantee: open ≥ close, 6 jours, doublon, format, weekday hors plage', async () => {
    await expect(admin.putWeekly(STORE, week({ 2: { openTime: '20:00', closeTime: '09:00' } }), ACTOR))
      .rejects.toThrow(BadRequestException); // ouverture après fermeture
    await expect(admin.putWeekly(STORE, week().slice(0, 6), ACTOR)).rejects.toThrow(/7 jours/);
    const dup = week(); dup[1] = { ...dup[0] };
    await expect(admin.putWeekly(STORE, dup, ACTOR)).rejects.toThrow(/double/);
    await expect(admin.putWeekly(STORE, week({ 3: { openTime: '9h00' } }), ACTOR)).rejects.toThrow(/HH:MM/);
    const bad = week(); bad[6] = { ...bad[6], dayOfWeek: 7 };
    await expect(admin.putWeekly(STORE, bad, ACTOR)).rejects.toThrow(/0–6/);
    // and the source was NOT corrupted by the rejected writes:
    expect(await resolver.resolve(STORE, '2026-06-17')).toEqual({ openLocal: '09:00', closeLocal: '20:00' });
  });

  it('holidays: set-replace + the resolver closes ONLY the checked day; unknown key rejected', async () => {
    await admin.putHolidays(STORE, ['noel'], ACTOR);
    expect(await resolver.resolve(STORE, '2026-12-25')).toBe('closed');
    await admin.putHolidays(STORE, ['fete_nationale'], ACTOR); // replaces, does not accumulate
    expect(await resolver.resolve(STORE, '2026-12-25')).not.toBe('closed');
    expect(await resolver.resolve(STORE, '2026-07-14')).toBe('closed');
    expect((await admin.getHolidays(STORE)).filter((h) => h.closed)).toHaveLength(1);
    await expect(admin.putHolidays(STORE, ['black_friday'], ACTOR)).rejects.toThrow(/inconnu/);
  });

  it('GET weekly falls back to the network default and says so', async () => {
    const other = uuidv4();
    const r = await admin.getWeekly(other);
    expect(r.source).toBe('none'); // nothing seeded in this harness — honest
    await ds.getRepository(AnalyticsStoreWeeklyHoursEntity).save(
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ storeId: null, weekday, openLocal: '09:00', closeLocal: '20:00', isClosed: false, isActive: true })) as any,
    );
    const r2 = await admin.getWeekly(other);
    expect(r2.source).toBe('default');
    expect(r2.days).toHaveLength(7);
    const r3 = await admin.getWeekly(STORE);
    expect(r3.source).toBe('store');
  });
});
