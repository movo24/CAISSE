/**
 * Étage 2 — store_closed_late rule. Open sessions past the configured closing hour,
 * from analytics.store_sessions only (INV-4); the closing hour is data.
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { AnalyticsStoreSessionsEntity } from '../src/database/entities/analytics-store-sessions.entity';
import { StoreClosedLateRule } from '../src/modules/alerts-engine/rules/store-closed-late.rule';

const PARAMS = { close_hour_utc: 21 };
const DAY = '2026-06-12';
const LATE = new Date('2026-06-12T22:30:00Z'); // past 21h UTC
const EARLY = new Date('2026-06-12T15:00:00Z');

describe('Étage 2 — store_closed_late rule', () => {
  let ds: DataSource;
  let rule: StoreClosedLateRule;

  const seed = async (open: number) => {
    const storeId = uuidv4();
    await ds.getRepository(AnalyticsStoreSessionsEntity).save({
      storeId, openSessions: open, activeTerminals: open, computedAt: LATE,
    } as any);
    return storeId;
  };
  const ctx = (storeId: string, now: Date, params: any = PARAMS) => ({ storeId, businessDay: DAY, now, params });

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    rule = new StoreClosedLateRule(ds.getRepository(AnalyticsStoreSessionsEntity));
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('sessions still open past the closing hour → one "open_after_close" fact with evidence', async () => {
    const s = await seed(2);
    const facts = await rule.evaluate(ctx(s, LATE) as any);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ rule: 'store_closed_late', thresholdBand: 'open_after_close', businessDay: DAY });
    expect(facts[0].payload).toMatchObject({ openSessions: 2, closeHourUtc: 21, observedHourUtc: 22 });
  });

  it('ADVERSE — before the closing hour → silent (the store is legitimately open)', async () => {
    const s = await seed(3);
    expect(await rule.evaluate(ctx(s, EARLY) as any)).toEqual([]);
  });

  it('ADVERSE — properly closed (0 open sessions) past the hour → silent', async () => {
    const s = await seed(0);
    expect(await rule.evaluate(ctx(s, LATE) as any)).toEqual([]);
  });

  it('ADVERSE — no config → silent', async () => {
    const s = await seed(5);
    expect(await rule.evaluate(ctx(s, LATE, null) as any)).toEqual([]);
  });
});
