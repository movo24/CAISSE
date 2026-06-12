/**
 * Étage 2 — stock_low rule. Derives from analytics.store_stock only (INV-4).
 * 'rupture' fires on any rupture; 'low_stock' only at/over the configured floor.
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { AnalyticsStoreStockEntity } from '../src/database/entities/analytics-store-stock.entity';
import { StockLowRule } from '../src/modules/alerts-engine/rules/stock-low.rule';

const PARAMS = { low_count_min: 5 };

describe('Étage 2 — stock_low rule', () => {
  let ds: DataSource;
  let rule: StockLowRule;
  const DAY = '2026-06-12';
  const NOW = new Date('2026-06-12T15:00:00Z');

  const seed = async (rupture: number, low: number) => {
    const storeId = uuidv4();
    await ds.getRepository(AnalyticsStoreStockEntity).save({
      storeId, ruptureCount: rupture, lowStockCount: low, computedAt: NOW,
    } as any);
    return storeId;
  };
  const ctx = (storeId: string, params: any = PARAMS) => ({ storeId, businessDay: DAY, now: NOW, params });

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    rule = new StockLowRule(ds.getRepository(AnalyticsStoreStockEntity));
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('rupture + low over floor → both bands with evidence', async () => {
    const s = await seed(2, 7);
    const facts = await rule.evaluate(ctx(s) as any);
    expect(facts.map((f) => f.thresholdBand).sort()).toEqual(['low_stock', 'rupture']);
    expect(facts.find((f) => f.thresholdBand === 'rupture')!.payload).toMatchObject({ ruptureCount: 2 });
  });

  it('single rupture, low below floor → rupture only', async () => {
    const s = await seed(1, 3);
    const facts = await rule.evaluate(ctx(s) as any);
    expect(facts.map((f) => f.thresholdBand)).toEqual(['rupture']);
  });

  it('ADVERSE — healthy stock (0 rupture, low under floor) → silent', async () => {
    const s = await seed(0, 4);
    expect(await rule.evaluate(ctx(s) as any)).toEqual([]);
  });

  it('ADVERSE — no snapshot for the store → silent (no invented zero-stock fact)', async () => {
    expect(await rule.evaluate(ctx(uuidv4()) as any)).toEqual([]);
  });

  it('ADVERSE — no config → silent', async () => {
    const s = await seed(1, 9);
    expect(await rule.evaluate(ctx(s, null) as any)).toEqual([]);
  });
});
