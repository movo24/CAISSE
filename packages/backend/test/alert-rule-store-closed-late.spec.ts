/**
 * Étage 2 — store_closed_late rule, now reading analytics.store_clock — the
 * SINGLE wall-clock datum shared with the ai-brief beats (ratified: never an
 * "alerts TZ" separate from a "beats TZ"). Per-store override else network
 * default; no clock datum → silent (no invented closing hour).
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { AnalyticsStoreSessionsEntity } from '../src/database/entities/analytics-store-sessions.entity';
import { AnalyticsStoreClockEntity } from '../src/database/entities/analytics-store-clock.entity';
import { StoreClosedLateRule } from '../src/modules/alerts-engine/rules/store-closed-late.rule';

const DAY = '2026-06-12';
const LATE = new Date('2026-06-12T22:30:00Z'); // past the default close 21 (UTC stand-in)
const EARLY = new Date('2026-06-12T15:00:00Z');

describe('Étage 2 — store_closed_late rule (single clock datum)', () => {
  let ds: DataSource;
  let rule: StoreClosedLateRule;

  const seedSessions = async (open: number) => {
    const storeId = uuidv4();
    await ds.getRepository(AnalyticsStoreSessionsEntity).save({
      storeId, openSessions: open, activeTerminals: open, computedAt: LATE,
    } as any);
    return storeId;
  };
  const ctx = (storeId: string, now: Date) => ({ storeId, businessDay: DAY, now, params: null });

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    rule = new StoreClosedLateRule(
      ds.getRepository(AnalyticsStoreSessionsEntity),
      ds.getRepository(AnalyticsStoreClockEntity),
    );
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('ADVERSE — NO clock datum → silent (no invented closing hour)', async () => {
    const s = await seedSessions(5);
    expect(await rule.evaluate(ctx(s, LATE) as any)).toEqual([]); // clock table still empty
  });

  it('sessions open past the network-default close hour → one "open_after_close" fact', async () => {
    await ds.getRepository(AnalyticsStoreClockEntity).save({
      storeId: null, timezone: 'Etc/UTC', briefBeatHours: [10, 15], closeHour: 21, isActive: true,
    } as any);
    const s = await seedSessions(2);
    const facts = await rule.evaluate(ctx(s, LATE) as any);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ rule: 'store_closed_late', thresholdBand: 'open_after_close', businessDay: DAY });
    expect(facts[0].payload).toMatchObject({ openSessions: 2, closeHour: 21, clockTimezone: 'Etc/UTC', observedHourUtc: 22 });
  });

  it('a PER-STORE clock override wins over the default (close 18 → fires at 19h)', async () => {
    const s = await seedSessions(1);
    await ds.getRepository(AnalyticsStoreClockEntity).save({
      storeId: s, timezone: 'Etc/UTC', briefBeatHours: [10, 15], closeHour: 18, isActive: true,
    } as any);
    const at19 = new Date('2026-06-12T19:00:00Z'); // < default 21 but ≥ override 18
    const facts = await rule.evaluate(ctx(s, at19) as any);
    expect(facts).toHaveLength(1);
    expect(facts[0].payload).toMatchObject({ closeHour: 18 });
  });

  it('ADVERSE — before the closing hour → silent (the store is legitimately open)', async () => {
    const s = await seedSessions(3);
    expect(await rule.evaluate(ctx(s, EARLY) as any)).toEqual([]);
  });

  it('ADVERSE — properly closed (0 open sessions) past the hour → silent', async () => {
    const s = await seedSessions(0);
    expect(await rule.evaluate(ctx(s, LATE) as any)).toEqual([]);
  });
});
