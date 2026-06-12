/**
 * Étage 2 — sales_drop rule. Last CLOSED day vs same-weekday baseline, from
 * analytics.store_daily history only (INV-4). Adverse: thin history silent
 * (greenfield-safe), small baseline silent, no-drop silent.
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { AnalyticsStoreDailyEntity } from '../src/database/entities/analytics-store-daily.entity';
import { SalesDropRule } from '../src/modules/alerts-engine/rules/sales-drop.rule';

const PARAMS = { drop_pct: 0.3, lookback_weeks: 4, min_weeks: 2, min_baseline_minor: 1000 };
const NOW = new Date('2026-06-12T08:00:00Z'); // closed day = 2026-06-11
const shift = (delta: number) => {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};

describe('Étage 2 — sales_drop rule', () => {
  let ds: DataSource;
  let rule: SalesDropRule;

  const seedDays = async (nets: Record<string, number>) => {
    const storeId = uuidv4();
    for (const [day, net] of Object.entries(nets)) {
      await ds.getRepository(AnalyticsStoreDailyEntity).save({
        storeId, businessDay: day, caBrutMinor: net, netMinor: net, txCount: 10, computedAt: NOW,
      } as any);
    }
    return storeId;
  };
  const ctx = (storeId: string, params: any = PARAMS) => ({ storeId, businessDay: shift(0), now: NOW, params });

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    rule = new SalesDropRule(ds.getRepository(AnalyticsStoreDailyEntity));
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('a 50% drop vs a 4-week same-weekday baseline → one "drop" fact on the CLOSED day', async () => {
    const s = await seedDays({
      [shift(-1)]: 5000, // closed day — dropped
      [shift(-8)]: 10000, [shift(-15)]: 10000, [shift(-22)]: 10000, [shift(-29)]: 10000,
    });
    const facts = await rule.evaluate(ctx(s) as any);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ rule: 'sales_drop', thresholdBand: 'drop', businessDay: shift(-1) });
    expect(facts[0].payload).toMatchObject({ netMinor: 5000, baselineMinor: 10000, observedDropPct: 0.5 });
  });

  it('ADVERSE — a 10% dip (under drop_pct 30%) → silent', async () => {
    const s = await seedDays({ [shift(-1)]: 9000, [shift(-8)]: 10000, [shift(-15)]: 10000 });
    expect(await rule.evaluate(ctx(s) as any)).toEqual([]);
  });

  it('ADVERSE — thin history (1 same-weekday row < min_weeks 2) → silent (greenfield-safe)', async () => {
    const s = await seedDays({ [shift(-1)]: 100, [shift(-8)]: 10000 });
    expect(await rule.evaluate(ctx(s) as any)).toEqual([]);
  });

  it('ADVERSE — baseline under the noise floor → silent', async () => {
    const s = await seedDays({ [shift(-1)]: 100, [shift(-8)]: 500, [shift(-15)]: 500 }); // baseline 500 < 1000
    expect(await rule.evaluate(ctx(s) as any)).toEqual([]);
  });

  it('ADVERSE — no row for the closed day → silent (nothing to judge)', async () => {
    const s = await seedDays({ [shift(-8)]: 10000, [shift(-15)]: 10000 });
    expect(await rule.evaluate(ctx(s) as any)).toEqual([]);
  });
});
