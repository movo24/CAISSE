import './helpers/env-setup';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { AiRecommendationLogEntity } from '../src/database/entities/ai-recommendation-log.entity';
import { AiLearningService } from '../src/modules/sales-ai/ai-learning.service';

/**
 * AiLearningService — recommendation tracking + learned scoring.
 *
 * Pure DB CRUD + in-JS aggregation over ai_recommendation_logs. No raw-SQL
 * arithmetic (all CTR / conversion / scoring math is JS), so pg-mem's integer
 * concatenation trap does not apply. Service is constructed directly with the
 * single repository it injects.
 */
describe('AiLearningService', () => {
  let ds: DataSource;
  let svc: AiLearningService;
  const STORE = uuidv4();
  const OTHER_STORE = uuidv4();

  const baseDisplay = (overrides: Partial<Parameters<AiLearningService['logDisplay']>[0]> = {}) => ({
    storeId: STORE,
    triggerProductId: uuidv4(),
    triggerProductName: 'Trigger',
    suggestedProductId: uuidv4(),
    suggestedProductName: 'Suggested',
    confidence: 0.8,
    estimatedCashImpact: 500,
    marginPercent: 0.4,
    ...overrides,
  });

  /** Seed N display logs for a single suggested product, optionally clicked/converted. */
  async function seed(opts: {
    suggestedProductId: string;
    storeId?: string;
    suggestedProductName?: string;
    count: number;
    clicked?: number;
    converted?: number;
    revenuePerConv?: number;
    marginPerConv?: number;
  }): Promise<void> {
    const repo = ds.getRepository(AiRecommendationLogEntity);
    for (let i = 0; i < opts.count; i++) {
      await repo.save({
        storeId: opts.storeId ?? STORE,
        employeeId: null,
        triggerProductId: uuidv4(),
        triggerProductName: 'Trigger',
        suggestedProductId: opts.suggestedProductId,
        suggestedProductName: opts.suggestedProductName ?? 'Suggested',
        confidence: 0.5,
        estimatedCashImpact: 0,
        marginPercent: 0,
        displayed: true,
        clicked: i < (opts.clicked ?? 0),
        addedToCart: false,
        converted: i < (opts.converted ?? 0),
        revenueGenerated: i < (opts.converted ?? 0) ? (opts.revenuePerConv ?? 0) : 0,
        marginGenerated: i < (opts.converted ?? 0) ? (opts.marginPerConv ?? 0) : 0,
        saleId: null,
      } as any);
    }
  }

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    svc = new AiLearningService(ds.getRepository(AiRecommendationLogEntity));
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  beforeEach(async () => {
    await ds.query('DELETE FROM ai_recommendation_logs');
  });

  // ── logDisplay ──
  describe('logDisplay', () => {
    it('persists a display row with tracking defaults and returns its id', async () => {
      const id = await svc.logDisplay(baseDisplay());
      expect(typeof id).toBe('string');
      const row = await ds.getRepository(AiRecommendationLogEntity).findOneByOrFail({ id });
      expect(row.displayed).toBe(true);
      expect(row.clicked).toBe(false);
      expect(row.addedToCart).toBe(false);
      expect(row.converted).toBe(false);
      expect(row.revenueGenerated).toBe(0);
      expect(row.marginGenerated).toBe(0);
    });

    it('coerces a missing employeeId to null', async () => {
      const id = await svc.logDisplay(baseDisplay());
      const row = await ds.getRepository(AiRecommendationLogEntity).findOneByOrFail({ id });
      expect(row.employeeId).toBeNull();
    });

    it('keeps a provided employeeId', async () => {
      const id = await svc.logDisplay(baseDisplay({ employeeId: 'emp-42' }));
      const row = await ds.getRepository(AiRecommendationLogEntity).findOneByOrFail({ id });
      expect(row.employeeId).toBe('emp-42');
    });
  });

  // ── click / cart / conversion transitions ──
  describe('state transitions', () => {
    it('logClick flips clicked to true', async () => {
      const id = await svc.logDisplay(baseDisplay());
      await svc.logClick(id);
      const row = await ds.getRepository(AiRecommendationLogEntity).findOneByOrFail({ id });
      expect(row.clicked).toBe(true);
      expect(row.converted).toBe(false); // unrelated flag untouched
    });

    it('logAddToCart flips addedToCart to true', async () => {
      const id = await svc.logDisplay(baseDisplay());
      await svc.logAddToCart(id);
      const row = await ds.getRepository(AiRecommendationLogEntity).findOneByOrFail({ id });
      expect(row.addedToCart).toBe(true);
    });

    it('logConversion records sale link, revenue and margin', async () => {
      const id = await svc.logDisplay(baseDisplay());
      const saleId = uuidv4();
      await svc.logConversion(id, saleId, 1200, 600);
      const row = await ds.getRepository(AiRecommendationLogEntity).findOneByOrFail({ id });
      expect(row.converted).toBe(true);
      expect(row.saleId).toBe(saleId);
      expect(Number(row.revenueGenerated)).toBe(1200);
      expect(Number(row.marginGenerated)).toBe(600);
    });
  });

  // ── getProductPerformance ──
  describe('getProductPerformance', () => {
    it('returns neutral defaults when there are no logs', async () => {
      const pid = uuidv4();
      const perf = await svc.getProductPerformance(pid, STORE);
      expect(perf.totalDisplayed).toBe(0);
      expect(perf.ctr).toBe(0);
      expect(perf.conversionRate).toBe(0);
      expect(perf.performanceScore).toBe(0.5); // neutral, no scoring applied below min displays
      expect(perf.status).toBe('active');
      expect(perf.suggestedProductName).toBe(pid); // falls back to id when no row
    });

    it('does not apply learned scoring below the min-displays threshold', async () => {
      const pid = uuidv4();
      // 10 displays, ZERO clicks → would blacklist if threshold reached, but only 10 < 20
      await seed({ suggestedProductId: pid, count: 10, clicked: 0 });
      const perf = await svc.getProductPerformance(pid, STORE);
      expect(perf.totalDisplayed).toBe(10);
      expect(perf.ctr).toBe(0);
      expect(perf.performanceScore).toBe(0.5);
      expect(perf.status).toBe('active');
    });

    it('blacklists a product below 3% CTR after 20+ displays', async () => {
      const pid = uuidv4();
      await seed({ suggestedProductId: pid, count: 25, clicked: 0 }); // ctr 0 < 0.03
      const perf = await svc.getProductPerformance(pid, STORE);
      expect(perf.totalDisplayed).toBe(25);
      expect(perf.status).toBe('blacklisted');
      expect(perf.performanceScore).toBe(0);
    });

    it('penalizes a product between 3% and 5% CTR after 20+ displays', async () => {
      const pid = uuidv4();
      // 25 displays, 1 click → ctr 0.04 → >= 0.03 (not blacklist) and < 0.05 (penalize)
      await seed({ suggestedProductId: pid, count: 25, clicked: 1 });
      const perf = await svc.getProductPerformance(pid, STORE);
      expect(perf.ctr).toBeCloseTo(0.04, 5);
      expect(perf.status).toBe('penalized');
      expect(perf.performanceScore).toBe(0.2);
    });

    it('boosts a product to score 1.0 when conversion >= 10% (and CTR healthy)', async () => {
      const pid = uuidv4();
      // 20 displays, all clicked, 2 converted → ctr 1.0, conv 0.10
      await seed({ suggestedProductId: pid, count: 20, clicked: 20, converted: 2 });
      const perf = await svc.getProductPerformance(pid, STORE);
      expect(perf.conversionRate).toBeCloseTo(0.1, 5);
      expect(perf.status).toBe('active');
      expect(perf.performanceScore).toBe(1.0);
    });

    it('caps the computed performanceScore at 1 for healthy-CTR low-conversion products', async () => {
      const pid = uuidv4();
      // 20 displays, all clicked, 1 converted → ctr 1.0, conv 0.05
      // ctr*5 + conv*3 = 5.15 → capped to 1
      await seed({ suggestedProductId: pid, count: 20, clicked: 20, converted: 1 });
      const perf = await svc.getProductPerformance(pid, STORE);
      expect(perf.status).toBe('active');
      expect(perf.performanceScore).toBe(1);
    });

    it('sums revenue and margin across logs', async () => {
      const pid = uuidv4();
      await seed({ suggestedProductId: pid, count: 5, clicked: 5, converted: 3, revenuePerConv: 100, marginPerConv: 40 });
      const perf = await svc.getProductPerformance(pid, STORE);
      expect(Number(perf.totalRevenueGenerated)).toBe(300);
      expect(Number(perf.totalMarginGenerated)).toBe(120);
    });

    it('scopes by store: other-store logs are ignored', async () => {
      const pid = uuidv4();
      await seed({ suggestedProductId: pid, storeId: OTHER_STORE, count: 30, clicked: 0 });
      const perf = await svc.getProductPerformance(pid, STORE);
      expect(perf.totalDisplayed).toBe(0);
      expect(perf.status).toBe('active'); // nothing for this store
    });

    it('excludes logs older than the lookback window', async () => {
      const pid = uuidv4();
      await seed({ suggestedProductId: pid, count: 3, clicked: 3 });
      const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
      await ds.query('UPDATE ai_recommendation_logs SET created_at=$1 WHERE suggested_product_id=$2', [old, pid]);
      const perf = await svc.getProductPerformance(pid, STORE, 30);
      expect(perf.totalDisplayed).toBe(0);
    });

    it('uses the stored suggestedProductName when logs exist', async () => {
      const pid = uuidv4();
      await seed({ suggestedProductId: pid, suggestedProductName: 'Coca 33cl', count: 2 });
      const perf = await svc.getProductPerformance(pid, STORE);
      expect(perf.suggestedProductName).toBe('Coca 33cl');
    });
  });

  // ── isBlacklisted ──
  describe('isBlacklisted', () => {
    it('is true for a product blacklisted by low CTR', async () => {
      const pid = uuidv4();
      await seed({ suggestedProductId: pid, count: 25, clicked: 0 });
      expect(await svc.isBlacklisted(pid, STORE)).toBe(true);
    });

    it('is false for a healthy product', async () => {
      const pid = uuidv4();
      await seed({ suggestedProductId: pid, count: 25, clicked: 25, converted: 5 });
      expect(await svc.isBlacklisted(pid, STORE)).toBe(false);
    });

    it('is false when there are no logs', async () => {
      expect(await svc.isBlacklisted(uuidv4(), STORE)).toBe(false);
    });
  });

  // ── getKPI ──
  describe('getKPI', () => {
    it('returns zeroed KPI with empty performer lists when no logs', async () => {
      const kpi = await svc.getKPI(STORE);
      expect(kpi.totalRecos).toBe(0);
      expect(kpi.globalCTR).toBe(0);
      expect(kpi.globalConversion).toBe(0);
      expect(kpi.avgRevenuePerReco).toBe(0);
      expect(kpi.avgMarginPerReco).toBe(0);
      expect(kpi.topPerformers).toEqual([]);
      expect(kpi.worstPerformers).toEqual([]);
    });

    it('aggregates global totals and rates across products', async () => {
      const a = uuidv4();
      const b = uuidv4();
      // A: 10 displays, 4 clicks, 2 conv (rev 100 each, margin 50 each)
      await seed({ suggestedProductId: a, count: 10, clicked: 4, converted: 2, revenuePerConv: 100, marginPerConv: 50 });
      // B: 10 displays, 0 clicks
      await seed({ suggestedProductId: b, count: 10, clicked: 0 });

      const kpi = await svc.getKPI(STORE);
      expect(kpi.totalRecos).toBe(20);
      expect(kpi.totalClicked).toBe(4);
      expect(kpi.totalConverted).toBe(2);
      expect(kpi.globalCTR).toBeCloseTo(4 / 20, 5);
      expect(kpi.globalConversion).toBeCloseTo(2 / 20, 5);
      expect(Number(kpi.totalRevenue)).toBe(200);
      expect(Number(kpi.totalMargin)).toBe(100);
      // averages are per CONVERSION, rounded
      expect(kpi.avgRevenuePerReco).toBe(100); // 200/2
      expect(kpi.avgMarginPerReco).toBe(50);   // 100/2
    });

    it('classifies a low-CTR high-volume product as a worst performer', async () => {
      const bad = uuidv4();
      const good = uuidv4();
      await seed({ suggestedProductId: bad, suggestedProductName: 'Dud', count: 25, clicked: 0 });
      await seed({ suggestedProductId: good, suggestedProductName: 'Star', count: 25, clicked: 25, converted: 5, revenuePerConv: 100, marginPerConv: 80 });

      const kpi = await svc.getKPI(STORE);
      const worstIds = kpi.worstPerformers.map((p) => p.suggestedProductId);
      const topIds = kpi.topPerformers.map((p) => p.suggestedProductId);
      expect(worstIds).toContain(bad);
      expect(topIds).toContain(good);
      expect(topIds).not.toContain(bad);
    });

    it('orders performers by margin generated (descending)', async () => {
      const low = uuidv4();
      const high = uuidv4();
      await seed({ suggestedProductId: low, count: 5, clicked: 5, converted: 1, revenuePerConv: 10, marginPerConv: 10 });
      await seed({ suggestedProductId: high, count: 5, clicked: 5, converted: 1, revenuePerConv: 10, marginPerConv: 90 });

      const kpi = await svc.getKPI(STORE);
      const active = kpi.topPerformers;
      // both active (below min-displays so status defaults active in KPI path)
      const highIdx = active.findIndex((p) => p.suggestedProductId === high);
      const lowIdx = active.findIndex((p) => p.suggestedProductId === low);
      expect(highIdx).toBeGreaterThanOrEqual(0);
      expect(lowIdx).toBeGreaterThanOrEqual(0);
      expect(highIdx).toBeLessThan(lowIdx); // higher margin first
    });

    it('caps topPerformers and worstPerformers at 5 entries each', async () => {
      // 7 healthy (active) products → topPerformers capped at 5
      for (let i = 0; i < 7; i++) {
        await seed({ suggestedProductId: uuidv4(), count: 3, clicked: 3, converted: 1, revenuePerConv: i + 1, marginPerConv: i + 1 });
      }
      // 7 blacklisted products → worstPerformers capped at 5
      for (let i = 0; i < 7; i++) {
        await seed({ suggestedProductId: uuidv4(), count: 25, clicked: 0 });
      }
      const kpi = await svc.getKPI(STORE);
      expect(kpi.topPerformers.length).toBe(5);
      expect(kpi.worstPerformers.length).toBe(5);
    });

    it('scopes by store', async () => {
      await seed({ suggestedProductId: uuidv4(), storeId: OTHER_STORE, count: 10, clicked: 5 });
      const kpi = await svc.getKPI(STORE);
      expect(kpi.totalRecos).toBe(0);
    });

    it('classifies a 3–5% CTR / 20+ display product as penalized with the matching performanceScore', async () => {
      const mid = uuidv4();
      // 1 click / 25 displays = 4% CTR (in [3%,5%)), 0 conversions → penalized, not blacklisted.
      await seed({ suggestedProductId: mid, suggestedProductName: 'Mid', count: 25, clicked: 1 });

      const kpi = await svc.getKPI(STORE);
      const entry = kpi.worstPerformers.find((p) => p.suggestedProductId === mid);
      expect(entry).toBeDefined();
      expect(entry!.status).toBe('penalized'); // ctr>=3% (not blacklisted), ctr<5% & 20+ displays (not active)
      expect(entry!.performanceScore).toBeCloseTo(0.2, 5); // min(1, 0.04*5 + 0*3)
    });
  });
});
