/**
 * Étage 2 — void_rate rule. Derives from analytics.store_daily only (INV-4).
 * Adversarial cases: below the min_tx noise floor → silent; below threshold →
 * silent; no config → silent (no built-in threshold).
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { AnalyticsStoreDailyEntity } from '../src/database/entities/analytics-store-daily.entity';
import { VoidRateRule } from '../src/modules/alerts-engine/rules/void-rate.rule';

const PARAMS = { warning_rate: 0.1, critical_rate: 0.2, min_tx: 10 };

describe('Étage 2 — void_rate rule', () => {
  let ds: DataSource;
  let rule: VoidRateRule;
  const DAY = '2026-06-12';
  const NOW = new Date('2026-06-12T15:00:00Z');

  const seed = async (storeId: string, txCount: number, voidCount: number) => {
    await ds.getRepository(AnalyticsStoreDailyEntity).save({
      storeId, businessDay: DAY, caBrutMinor: 1000, txCount, voidCount, voidAmountMinor: voidCount * 100, computedAt: NOW,
    } as any);
    return storeId;
  };
  const ctx = (storeId: string, params: any = PARAMS) => ({ storeId, businessDay: DAY, now: NOW, params });

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    rule = new VoidRateRule(ds.getRepository(AnalyticsStoreDailyEntity));
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('warning band: 2 voids / 18 tx (rate 10%) → one warning fact with evidence', async () => {
    const s = await seed(uuidv4(), 18, 2); // 2/20 = 0.10
    const facts = await rule.evaluate(ctx(s) as any);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ rule: 'void_rate', thresholdBand: 'warning', businessDay: DAY });
    expect(facts[0].payload).toMatchObject({ rate: 0.1, voidCount: 2, txCount: 18, threshold: 0.1 });
  });

  it('critical crossing emits BOTH bands (escalation = the next band, deduped per band)', async () => {
    const s = await seed(uuidv4(), 7, 3); // 3/10 = 0.30 ≥ critical 0.20
    const facts = await rule.evaluate(ctx(s) as any);
    expect(facts.map((f) => f.thresholdBand).sort()).toEqual(['critical', 'warning']);
  });

  it('ADVERSE — below the min_tx noise floor → silent even at a huge rate', async () => {
    const s = await seed(uuidv4(), 3, 3); // rate 50% but only 6 movements < min_tx 10
    expect(await rule.evaluate(ctx(s) as any)).toEqual([]);
  });

  it('ADVERSE — below threshold → silent', async () => {
    const s = await seed(uuidv4(), 19, 1); // 1/20 = 5% < warning 10%
    expect(await rule.evaluate(ctx(s) as any)).toEqual([]);
  });

  it('ADVERSE — no config → silent (no built-in threshold)', async () => {
    const s = await seed(uuidv4(), 5, 5);
    expect(await rule.evaluate(ctx(s, null) as any)).toEqual([]);
  });
});
