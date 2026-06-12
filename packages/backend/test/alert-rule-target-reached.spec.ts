/**
 * Étage 2 — target_reached rule. Reads the SHARED analytics.store_targets datum
 * (the same one overview's %atteint reads — one source, two readers) + the day's
 * caBrut from analytics.store_daily. Adverse: no datum → silent (no fabricated
 * objective), below target → silent, inactive datum → silent.
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { AnalyticsStoreDailyEntity } from '../src/database/entities/analytics-store-daily.entity';
import { AnalyticsStoreTargetEntity } from '../src/database/entities/analytics-store-target.entity';
import { TargetReachedRule } from '../src/modules/alerts-engine/rules/target-reached.rule';

const DAY = '2026-06-12';
const NOW = new Date('2026-06-12T18:00:00Z');

describe('Étage 2 — target_reached rule', () => {
  let ds: DataSource;
  let rule: TargetReachedRule;

  const seed = async (caBrut: number, target: number | null, active = true) => {
    const storeId = uuidv4();
    await ds.getRepository(AnalyticsStoreDailyEntity).save({
      storeId, businessDay: DAY, caBrutMinor: caBrut, txCount: 10, computedAt: NOW,
    } as any);
    if (target !== null) {
      await ds.getRepository(AnalyticsStoreTargetEntity).save({
        storeId, dailyTargetMinor: target, isActive: active,
      } as any);
    }
    return storeId;
  };
  const ctx = (storeId: string) => ({ storeId, businessDay: DAY, now: NOW, params: null });

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    rule = new TargetReachedRule(
      ds.getRepository(AnalyticsStoreDailyEntity),
      ds.getRepository(AnalyticsStoreTargetEntity),
    );
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('caBrut reaches the shared datum → one "reached" fact with %', async () => {
    const s = await seed(120000, 100000);
    const facts = await rule.evaluate(ctx(s) as any);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ rule: 'target_reached', thresholdBand: 'reached', businessDay: DAY });
    expect(facts[0].payload).toMatchObject({ caBrutMinor: 120000, targetMinor: 100000, reachedPct: 120 });
  });

  it('ADVERSE — below the target → silent', async () => {
    const s = await seed(80000, 100000);
    expect(await rule.evaluate(ctx(s) as any)).toEqual([]);
  });

  it('ADVERSE — NO datum → silent (no fabricated objective — the INV-3 seal)', async () => {
    const s = await seed(999999, null);
    expect(await rule.evaluate(ctx(s) as any)).toEqual([]);
  });

  it('ADVERSE — inactive datum → silent', async () => {
    const s = await seed(999999, 100000, false);
    expect(await rule.evaluate(ctx(s) as any)).toEqual([]);
  });
});
