/**
 * Étage 2 — discount_rate rule. rate = discount / (caBrut + discount), from
 * analytics.store_daily only (INV-4 — the projection stores the raw figures, the
 * rule computes the ratio). Adverse: noise floor, below threshold, no config.
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { AnalyticsStoreDailyEntity } from '../src/database/entities/analytics-store-daily.entity';
import { DiscountRateRule } from '../src/modules/alerts-engine/rules/discount-rate.rule';

const PARAMS = { warning_rate: 0.1, critical_rate: 0.2, min_tx: 10 };
const DAY = '2026-06-12';
const NOW = new Date('2026-06-12T15:00:00Z');

describe('Étage 2 — discount_rate rule', () => {
  let ds: DataSource;
  let rule: DiscountRateRule;

  const seed = async (caBrut: number, discount: number, tx: number) => {
    const storeId = uuidv4();
    await ds.getRepository(AnalyticsStoreDailyEntity).save({
      storeId, businessDay: DAY, caBrutMinor: caBrut, discountTotalMinor: discount, txCount: tx, computedAt: NOW,
    } as any);
    return storeId;
  };
  const ctx = (storeId: string, params: any = PARAMS) => ({ storeId, businessDay: DAY, now: NOW, params });

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    rule = new DiscountRateRule(ds.getRepository(AnalyticsStoreDailyEntity));
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('warning band: 1000 discount on 9000 post-discount CA (rate 10%) → one warning fact', async () => {
    const s = await seed(9000, 1000, 20); // 1000 / (9000+1000) = 0.10
    const facts = await rule.evaluate(ctx(s) as any);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ rule: 'discount_rate', thresholdBand: 'warning', businessDay: DAY });
    expect(facts[0].payload).toMatchObject({ rate: 0.1, discountTotalMinor: 1000, threshold: 0.1 });
  });

  it('critical crossing emits BOTH bands', async () => {
    const s = await seed(7000, 3000, 20); // 3000/10000 = 0.30 ≥ critical 0.20
    const facts = await rule.evaluate(ctx(s) as any);
    expect(facts.map((f) => f.thresholdBand).sort()).toEqual(['critical', 'warning']);
  });

  it('ADVERSE — below the min_tx noise floor → silent even at a huge rate', async () => {
    const s = await seed(500, 500, 4); // rate 50% but 4 tx < 10
    expect(await rule.evaluate(ctx(s) as any)).toEqual([]);
  });

  it('ADVERSE — below threshold → silent', async () => {
    const s = await seed(9700, 300, 20); // 300/10000 = 3%
    expect(await rule.evaluate(ctx(s) as any)).toEqual([]);
  });

  it('ADVERSE — no config → silent', async () => {
    const s = await seed(0, 5000, 50);
    expect(await rule.evaluate(ctx(s, null) as any)).toEqual([]);
  });
});
