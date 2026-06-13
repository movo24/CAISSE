/**
 * Schedule resolver (commit 2 — weekly only). The SINGLE schedule source:
 * per-store override else network default; is_closed → CLOSED; no datum → null
 * (honest absence). Weekday derived zone-free from the LOCAL day string.
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { AnalyticsStoreWeeklyHoursEntity } from '../src/database/entities/analytics-store-weekly-hours.entity';
import { AnalyticsStoreHolidayClosureEntity } from '../src/database/entities/analytics-store-holiday-closure.entity';
import { StoreScheduleService, weekdayOf, minutesOf } from '../src/modules/store-schedule/store-schedule.service';

describe('Schedule resolver — weekly hours (single source)', () => {
  let ds: DataSource;
  let svc: StoreScheduleService;
  const STORE = uuidv4(); // has a full per-store override
  const OTHER = uuidv4(); // no override → network default

  const wh = (storeId: string | null, weekday: number, over: Partial<AnalyticsStoreWeeklyHoursEntity> = {}) => ({
    storeId, weekday, openLocal: '09:00', closeLocal: '20:00', isClosed: false, isActive: true, ...over,
  });

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    const repo = ds.getRepository(AnalyticsStoreWeeklyHoursEntity);
    // network default: 7 days open 09:00–20:00 (the migration's seed shape)
    for (let d = 0; d <= 6; d++) await repo.save(wh(null, d) as any);
    // per-store override: dimanche FERMÉ, samedi nocturne 10:00–22:00, autres 09:00–20:00
    for (let d = 0; d <= 6; d++) {
      if (d === 0) await repo.save(wh(STORE, 0, { isClosed: true, openLocal: null, closeLocal: null }) as any);
      else if (d === 6) await repo.save(wh(STORE, 6, { openLocal: '10:00', closeLocal: '22:00' }) as any);
      else await repo.save(wh(STORE, d) as any);
    }
    svc = new StoreScheduleService(repo, ds.getRepository(AnalyticsStoreHolidayClosureEntity));
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('weekdayOf is zone-free on the LOCAL day string (2026-06-21 = dimanche, 2026-06-20 = samedi)', () => {
    expect(weekdayOf('2026-06-21')).toBe(0);
    expect(weekdayOf('2026-06-20')).toBe(6);
    expect(weekdayOf('2026-06-15')).toBe(1); // lundi
  });

  it('per-store override wins: dimanche → CLOSED, samedi → the nocturne pair', async () => {
    expect(await svc.resolve(STORE, '2026-06-21')).toBe('closed');
    expect(await svc.resolve(STORE, '2026-06-20')).toEqual({ openLocal: '10:00', closeLocal: '22:00' });
    expect(await svc.resolve(STORE, '2026-06-15')).toEqual({ openLocal: '09:00', closeLocal: '20:00' });
  });

  it('no override → network default (open every day, 09:00–20:00)', async () => {
    expect(await svc.resolve(OTHER, '2026-06-21')).toEqual({ openLocal: '09:00', closeLocal: '20:00' });
  });

  it('HOLIDAY closure composes ABOVE the weekly row (férié > hebdo), per-store only', async () => {
    // 2026-07-14 = mardi (fête nationale). STORE checks the closure; OTHER does not.
    await ds.getRepository(AnalyticsStoreHolidayClosureEntity).save({ storeId: STORE, holidayKey: 'fete_nationale' } as any);
    expect(await svc.resolve(STORE, '2026-07-14')).toBe('closed'); // weekly says open 09:00–20:00 — the holiday wins
    expect(await svc.resolve(OTHER, '2026-07-14')).toEqual({ openLocal: '09:00', closeLocal: '20:00' }); // unchecked store stays open
    // an UNchecked holiday (noël) does not close STORE:
    expect(await svc.resolve(STORE, '2026-12-25')).not.toBe('closed');
  });

  it('no datum at all → null (honest absence, callers skip)', async () => {
    await ds.getRepository(AnalyticsStoreWeeklyHoursEntity).createQueryBuilder().delete().execute();
    expect(await svc.resolve(OTHER, '2026-06-15')).toBeNull();
  });

  it('minutesOf converts HH:MM for threshold compares', () => {
    expect(minutesOf('20:00')).toBe(1200);
    expect(minutesOf('09:30')).toBe(570);
  });
});
