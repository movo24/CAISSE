/**
 * Étage 2 — store_closed_late rule. Closing time = THE SCHEDULE RESOLVER
 * (store_weekly_hours, single source shared with the close beat); timezone =
 * the store_clock datum (A1, LOCAL wall-clock, DST-correct). Silent without a
 * clock datum OR without a schedule datum (no invented hours); a day the
 * schedule resolves CLOSED never fires (ratified ADVERSE).
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { AnalyticsStoreSessionsEntity } from '../src/database/entities/analytics-store-sessions.entity';
import { AnalyticsStoreClockEntity } from '../src/database/entities/analytics-store-clock.entity';
import { AnalyticsStoreWeeklyHoursEntity } from '../src/database/entities/analytics-store-weekly-hours.entity';
import { AnalyticsStoreHolidayClosureEntity } from '../src/database/entities/analytics-store-holiday-closure.entity';
import { StoreScheduleService } from '../src/modules/store-schedule/store-schedule.service';
import { StoreClosedLateRule } from '../src/modules/alerts-engine/rules/store-closed-late.rule';

const DAY = '2026-06-12'; // vendredi
const LATE = new Date('2026-06-12T22:30:00Z'); // past the default close 21:00 (UTC clock)
const EARLY = new Date('2026-06-12T15:00:00Z');

describe('Étage 2 — store_closed_late rule (schedule resolver + clock TZ)', () => {
  let ds: DataSource;
  let rule: StoreClosedLateRule;

  const seedSessions = async (open: number) => {
    const storeId = uuidv4();
    await ds.getRepository(AnalyticsStoreSessionsEntity).save({
      storeId, openSessions: open, activeTerminals: open, computedAt: LATE,
    } as any);
    return storeId;
  };
  const seedWeek = async (storeId: string | null, openLocal: string, closeLocal: string) => {
    const repo = ds.getRepository(AnalyticsStoreWeeklyHoursEntity);
    for (let weekday = 0; weekday <= 6; weekday++) {
      await repo.save({ storeId, weekday, openLocal, closeLocal, isClosed: false, isActive: true } as any);
    }
  };
  const ctx = (storeId: string, now: Date, businessDay = DAY) => ({ storeId, businessDay, now, params: null });

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    rule = new StoreClosedLateRule(
      ds.getRepository(AnalyticsStoreSessionsEntity),
      ds.getRepository(AnalyticsStoreClockEntity),
      new StoreScheduleService(ds.getRepository(AnalyticsStoreWeeklyHoursEntity), ds.getRepository(AnalyticsStoreHolidayClosureEntity)),
    );
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('ADVERSE — NO clock datum → silent (no invented wall-clock)', async () => {
    const s = await seedSessions(5);
    expect(await rule.evaluate(ctx(s, LATE) as any)).toEqual([]); // clock table still empty
  });

  it('ADVERSE — clock present but NO schedule datum → silent (no invented closing time)', async () => {
    await ds.getRepository(AnalyticsStoreClockEntity).save({
      storeId: null, timezone: 'Etc/UTC', briefBeatHours: [10, 15], isActive: true,
    } as any);
    const s = await seedSessions(4);
    expect(await rule.evaluate(ctx(s, LATE) as any)).toEqual([]); // weekly_hours still empty
  });

  it('sessions open past the network-default close → one "open_after_close" fact', async () => {
    await seedWeek(null, '09:00', '21:00'); // network default schedule
    const s = await seedSessions(2);
    const facts = await rule.evaluate(ctx(s, LATE) as any);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ rule: 'store_closed_late', thresholdBand: 'open_after_close', businessDay: DAY });
    expect(facts[0].payload).toMatchObject({ openSessions: 2, closeLocal: '21:00', clockTimezone: 'Etc/UTC', observedLocal: '22:30' });
  });

  it('a PER-STORE schedule override wins over the default (close 18:00 → fires at 19h)', async () => {
    const s = await seedSessions(1);
    await seedWeek(s, '09:00', '18:00');
    const at19 = new Date('2026-06-12T19:00:00Z'); // < default 21:00 but ≥ override 18:00
    const facts = await rule.evaluate(ctx(s, at19) as any);
    expect(facts).toHaveLength(1);
    expect(facts[0].payload).toMatchObject({ closeLocal: '18:00' });
  });

  it('DECISIVE DST (A1) — LOCAL wall-clock: same wall hour on both sides of the Paris flip → same behaviour', async () => {
    const s = await seedSessions(2);
    await ds.getRepository(AnalyticsStoreClockEntity).save({
      storeId: s, timezone: 'Europe/Paris', briefBeatHours: [12, 17], isActive: true,
    } as any);
    await seedWeek(s, '09:00', '20:00');
    // Saturday pre-flip (UTC+1): 19:30Z = 20:30 LOCAL → fires.
    const pre = await rule.evaluate(ctx(s, new Date('2026-03-28T19:30:00Z')) as any);
    // Monday post-flip (UTC+2): 18:30Z = 20:30 LOCAL → fires too — the UTC hour (18)
    // is BELOW the 20:00 close: the old UTC stand-in would have stayed silent here.
    const post = await rule.evaluate(ctx(s, new Date('2026-03-30T18:30:00Z')) as any);
    expect(pre).toHaveLength(1);
    expect(post).toHaveLength(1);
    expect(pre[0].payload).toMatchObject({ observedLocal: '20:30', clockTimezone: 'Europe/Paris' });
    expect(post[0].payload).toMatchObject({ observedLocal: '20:30', clockTimezone: 'Europe/Paris' });
  });

  it('ADVERSE (ratified) — a day the schedule resolves CLOSED never fires, sessions open or not', async () => {
    const s = await seedSessions(3); // sessions ARE open
    const repo = ds.getRepository(AnalyticsStoreWeeklyHoursEntity);
    for (let weekday = 0; weekday <= 6; weekday++) {
      await repo.save({
        storeId: s, weekday, openLocal: weekday === 0 ? null : '09:00', closeLocal: weekday === 0 ? null : '20:00',
        isClosed: weekday === 0, isActive: true,
      } as any);
    }
    const sundayLate = new Date('2026-06-14T22:30:00Z'); // dimanche, way past any close
    expect(await rule.evaluate(ctx(s, sundayLate, '2026-06-14') as any)).toEqual([]);
    // …and the SAME store fires on an open weekday (the silence above is the schedule, not a bug):
    const fridayLate = await rule.evaluate(ctx(s, LATE) as any);
    expect(fridayLate).toHaveLength(1);
  });

  it('ADVERSE — before the closing time → silent (the store is legitimately open)', async () => {
    const s = await seedSessions(3);
    expect(await rule.evaluate(ctx(s, EARLY) as any)).toEqual([]);
  });

  it('ADVERSE — properly closed (0 open sessions) past the time → silent', async () => {
    const s = await seedSessions(0);
    expect(await rule.evaluate(ctx(s, LATE) as any)).toEqual([]);
  });
});
