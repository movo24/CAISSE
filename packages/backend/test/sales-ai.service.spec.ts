/**
 * SalesAiService — DATA-ENGINE coverage.
 *
 * Scope of this suite (deterministic, pg-mem-runnable parts only):
 *  - getStoreStats(): real SQL aggregates over `sales` + `sale_line_items`
 *    (ticket count, avg basket, top products, dataQuality tiers, aiReady gate).
 *  - getRecommendations(): the pure recommendation-BUILDING business logic
 *    (silence guard, upsell confidence threshold, blacklist skip, external
 *    context boost, stock alerts, priority sort). computeAssociations() is
 *    spied because its raw SQL uses `NOW() - INTERVAL '<n> days'`, which
 *    pg-mem rejects ("cannot cast type timestamptz to timestamp"); the
 *    association SQL itself is therefore left for a gated real-Postgres spec.
 *
 * Constructor (exact order from source):
 *   new SalesAiService(saleRepo, lineRepo, productRepo, dataSource, learning, externalCtx)
 *  - learning  : AiLearningService     → mock { isBlacklisted }
 *  - externalCtx: ExternalContextService → mock { getFullContext }
 */
import './helpers/env-setup';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { StoreEntity } from '../src/database/entities/store.entity';
import { ProductEntity } from '../src/database/entities/product.entity';
import { SaleEntity } from '../src/database/entities/sale.entity';
import { SaleLineItemEntity } from '../src/database/entities/sale-line-item.entity';
import {
  SalesAiService,
  ProductAssociation,
} from '../src/modules/sales-ai/sales-ai.service';

// Neutral external context: nothing available → zero boost (deterministic).
const neutralCtx = () => ({
  weather: { available: false, impactScore: 0, description: '', impactReason: '' },
  transport: { available: false, impactScore: 0, hasDisruptions: false, impactReason: '' },
});

const baseAssoc = (over: Partial<ProductAssociation> = {}): ProductAssociation => ({
  productA: 'pa',
  productAName: 'A',
  productB: 'pb',
  productBName: 'B',
  coOccurrences: 20,
  totalTicketsA: 100,
  attachmentRate: 0.4,
  confidence: 0.9,
  marginBoost: 100,
  marginPercent: 40,
  estimatedCashImpact: 40,
  stockPressure: 'healthy',
  ...over,
});

describe('SalesAiService', () => {
  let ds: DataSource;
  let svc: SalesAiService;
  let learning: { isBlacklisted: jest.Mock };
  let externalCtx: { getFullContext: jest.Mock };
  let storeRepo: ReturnType<DataSource['getRepository']>;
  let productRepo: ReturnType<DataSource['getRepository']>;
  let saleRepo: ReturnType<DataSource['getRepository']>;
  let lineRepo: ReturnType<DataSource['getRepository']>;

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    storeRepo = ds.getRepository(StoreEntity);
    productRepo = ds.getRepository(ProductEntity);
    saleRepo = ds.getRepository(SaleEntity);
    lineRepo = ds.getRepository(SaleLineItemEntity);
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  beforeEach(async () => {
    // Order matters: children before parents (FKs). pg-mem has no TRUNCATE.
    await ds.query('DELETE FROM sale_line_items');
    await ds.query('DELETE FROM sales');
    await ds.query('DELETE FROM products');
    await ds.query('DELETE FROM stores');
    learning = { isBlacklisted: jest.fn().mockResolvedValue(false) };
    externalCtx = { getFullContext: jest.fn().mockResolvedValue(neutralCtx()) };
    svc = new SalesAiService(
      saleRepo as any,
      lineRepo as any,
      productRepo as any,
      ds,
      learning as any,
      externalCtx as any,
    );
  });

  /** Create a store row and return its id (products FK -> stores). */
  async function makeStore(): Promise<string> {
    const s: any = await storeRepo.save(storeRepo.create({ name: 'Store' } as any));
    return s.id;
  }

  async function makeProduct(
    storeId: string,
    over: Partial<ProductEntity> = {},
  ): Promise<ProductEntity> {
    return productRepo.save(
      productRepo.create({
        ean: uuidv4().slice(0, 8),
        name: 'Product',
        priceMinorUnits: 200,
        currencyCode: 'EUR',
        storeId,
        stockQuantity: 50,
        stockAlertThreshold: 5,
        isActive: true,
        ...over,
      } as any),
    ) as any;
  }

  async function makeSale(
    storeId: string,
    over: Partial<SaleEntity> = {},
  ): Promise<SaleEntity> {
    return saleRepo.save(
      saleRepo.create({
        storeId,
        employeeId: 'emp',
        status: 'completed',
        ticketNumber: uuidv4().slice(0, 8),
        totalMinorUnits: 1000,
        currencyCode: 'EUR',
        ...over,
      } as any),
    ) as any;
  }

  async function makeLine(
    sale: SaleEntity,
    over: Partial<SaleLineItemEntity> = {},
  ): Promise<SaleLineItemEntity> {
    return lineRepo.save(
      lineRepo.create({
        saleId: (sale as any).id,
        productId: 'p',
        productName: 'Line',
        ean: '1',
        quantity: 1,
        unitPriceMinorUnits: 500,
        lineTotalMinorUnits: 500,
        taxRate: 20,
        ...over,
      } as any),
    ) as any;
  }

  // ════════════════════════════════════════════════════════════════
  //  getStoreStats — real SQL aggregates
  // ════════════════════════════════════════════════════════════════
  describe('getStoreStats', () => {
    it('returns zeros + insufficient quality + aiReady=false for an empty store', async () => {
      const storeId = await makeStore();
      const res = await svc.getStoreStats(storeId);
      expect(res.totalTickets).toBe(0);
      expect(res.avgBasket).toBe(0);
      expect(res.topProducts).toEqual([]);
      expect(res.dataQuality).toBe('insufficient');
      expect(res.aiReady).toBe(false);
    });

    it('counts only completed sales for THIS store and computes avg basket', async () => {
      const storeId = await makeStore();
      const otherStoreId = await makeStore();
      await makeSale(storeId, { totalMinorUnits: 1000 });
      await makeSale(storeId, { totalMinorUnits: 3000 });
      // Must be excluded: not completed.
      await makeSale(storeId, { status: 'pending', totalMinorUnits: 99999 });
      // Must be excluded: different store.
      await makeSale(otherStoreId, { totalMinorUnits: 50000 });

      const res = await svc.getStoreStats(storeId);
      expect(res.totalTickets).toBe(2);
      // avg of 1000 & 3000 = 2000; proves status + store filtering really applied.
      expect(res.avgBasket).toBe(2000);
    });

    it('aggregates top products by quantity (desc) with summed revenue', async () => {
      const storeId = await makeStore();
      const s1 = await makeSale(storeId);
      const s2 = await makeSale(storeId);
      // "Cafe": qty 2 + 1 = 3, revenue 1000 + 500 = 1500
      await makeLine(s1, { productName: 'Cafe', quantity: 2, lineTotalMinorUnits: 1000 });
      await makeLine(s2, { productName: 'Cafe', quantity: 1, lineTotalMinorUnits: 500 });
      // "Sucre": qty 1, revenue 300
      await makeLine(s1, { productName: 'Sucre', quantity: 1, lineTotalMinorUnits: 300 });

      const res = await svc.getStoreStats(storeId);
      expect(res.topProducts.length).toBe(2);
      // Highest quantity first.
      expect(res.topProducts[0]).toEqual({ name: 'Cafe', count: 3, revenue: 1500 });
      expect(res.topProducts[1]).toEqual({ name: 'Sucre', count: 1, revenue: 300 });
    });

    it('maps ticket count to dataQuality tiers (basic <100, good <500)', async () => {
      const basicStore = await makeStore();
      for (let i = 0; i < 25; i++) await makeSale(basicStore);
      const basic = await svc.getStoreStats(basicStore);
      expect(basic.totalTickets).toBe(25);
      expect(basic.dataQuality).toBe('basic'); // 20 <= 25 < 100
      // 25 < MIN_TICKETS_FOR_ASSOCIATION(100) → engine not ready yet.
      expect(basic.aiReady).toBe(false);
    });

    it('flags aiReady=true and dataQuality=good once >= 100 completed tickets exist', async () => {
      const storeId = await makeStore();
      for (let i = 0; i < 100; i++) await makeSale(storeId);
      const res = await svc.getStoreStats(storeId);
      expect(res.totalTickets).toBe(100);
      expect(res.dataQuality).toBe('good'); // 100 <= x < 500
      expect(res.aiReady).toBe(true);
    });
  });

  // ════════════════════════════════════════════════════════════════
  //  getRecommendations — recommendation-building logic
  //  (computeAssociations is spied; its INTERVAL SQL is out of pg-mem scope)
  // ════════════════════════════════════════════════════════════════
  describe('getRecommendations', () => {
    it('returns a single SILENCE reco when no associations are available', async () => {
      const storeId = await makeStore();
      jest.spyOn(svc, 'computeAssociations').mockResolvedValue([]);

      const res = await svc.getRecommendations(storeId, [
        { productId: 'whatever', name: 'X' },
      ]);

      expect(res).toHaveLength(1);
      expect(res[0].type).toBe('silence');
      expect(res[0].confidence).toBe(0);
      // External context must NOT even be consulted on the silence path.
      expect(externalCtx.getFullContext).not.toHaveBeenCalled();
    });

    it('emits an UPSELL when cart contains productA and confidence >= MIN_CONFIDENCE', async () => {
      const storeId = await makeStore();
      const a = await makeProduct(storeId, { name: 'Cafe', stockQuantity: 100 });
      const b = await makeProduct(storeId, { name: 'Sucre', stockQuantity: 100 });
      jest.spyOn(svc, 'computeAssociations').mockResolvedValue([
        baseAssoc({
          productA: a.id,
          productAName: 'Cafe',
          productB: b.id,
          productBName: 'Sucre',
          confidence: 0.9,
          attachmentRate: 0.4,
          estimatedCashImpact: 40,
        }),
      ]);

      const res = await svc.getRecommendations(storeId, [
        { productId: a.id, name: 'Cafe' },
      ]);

      const upsell = res.find((r) => r.type === 'upsell');
      expect(upsell).toBeDefined();
      expect(upsell!.suggestedProductId).toBe(b.id);
      expect(upsell!.suggestedProductName).toBe('Sucre');
      expect(upsell!.confidence).toBeCloseTo(0.9, 5);
      expect(upsell!.impact).toBe('+0.40€ marge'); // estimatedCashImpact 40 / 100
      expect(learning.isBlacklisted).toHaveBeenCalledWith(b.id, storeId);
    });

    it('does NOT emit an upsell when confidence is below MIN_CONFIDENCE (0.75)', async () => {
      const storeId = await makeStore();
      const a = await makeProduct(storeId, { name: 'Cafe', stockQuantity: 100 });
      const b = await makeProduct(storeId, { name: 'Sucre', stockQuantity: 100 });
      jest.spyOn(svc, 'computeAssociations').mockResolvedValue([
        baseAssoc({ productA: a.id, productB: b.id, confidence: 0.5 }),
      ]);

      const res = await svc.getRecommendations(storeId, [
        { productId: a.id, name: 'Cafe' },
      ]);
      expect(res.find((r) => r.type === 'upsell')).toBeUndefined();
      // The insight branch also requires confidence >= MIN_CONFIDENCE.
      expect(res.find((r) => r.type === 'insight')).toBeUndefined();
    });

    it('skips the upsell for a blacklisted suggested product', async () => {
      const storeId = await makeStore();
      const a = await makeProduct(storeId, { name: 'Cafe', stockQuantity: 100 });
      const b = await makeProduct(storeId, { name: 'Sucre', stockQuantity: 100 });
      learning.isBlacklisted.mockResolvedValue(true);
      jest.spyOn(svc, 'computeAssociations').mockResolvedValue([
        baseAssoc({ productA: a.id, productB: b.id, confidence: 0.9 }),
      ]);

      const res = await svc.getRecommendations(storeId, [
        { productId: a.id, name: 'Cafe' },
      ]);
      expect(res.find((r) => r.type === 'upsell')).toBeUndefined();
    });

    it('does NOT upsell a product already in the cart', async () => {
      const storeId = await makeStore();
      const a = await makeProduct(storeId, { name: 'Cafe', stockQuantity: 100 });
      const b = await makeProduct(storeId, { name: 'Sucre', stockQuantity: 100 });
      jest.spyOn(svc, 'computeAssociations').mockResolvedValue([
        baseAssoc({ productA: a.id, productB: b.id, confidence: 0.9 }),
      ]);

      const res = await svc.getRecommendations(storeId, [
        { productId: a.id, name: 'Cafe' },
        { productId: b.id, name: 'Sucre' }, // already present
      ]);
      expect(res.find((r) => r.type === 'upsell')).toBeUndefined();
      // isBlacklisted is only reached past the in-cart guard → never called.
      expect(learning.isBlacklisted).not.toHaveBeenCalled();
    });

    it('emits an INSIGHT for the top association even with an empty cart', async () => {
      const storeId = await makeStore();
      const a = await makeProduct(storeId, { name: 'Cafe', stockQuantity: 100 });
      const b = await makeProduct(storeId, { name: 'Sucre', stockQuantity: 100 });
      jest.spyOn(svc, 'computeAssociations').mockResolvedValue([
        baseAssoc({
          productA: a.id,
          productAName: 'Cafe',
          productB: b.id,
          productBName: 'Sucre',
          confidence: 0.85,
        }),
      ]);

      const res = await svc.getRecommendations(storeId, []);
      const insight = res.find((r) => r.type === 'insight');
      expect(insight).toBeDefined();
      expect(insight!.actionability).toBe('watch');
      expect(insight!.message).toContain('Cafe');
      expect(insight!.message).toContain('Sucre');
      // No cart → no upsell.
      expect(res.find((r) => r.type === 'upsell')).toBeUndefined();
    });

    it('raises a STOCK ALERT when an associated product is at/below its alert threshold', async () => {
      const storeId = await makeStore();
      const a = await makeProduct(storeId, { name: 'Cafe', stockQuantity: 100 });
      const lowStockB = await makeProduct(storeId, {
        name: 'Sucre',
        stockQuantity: 2,
        stockAlertThreshold: 5,
      });
      jest.spyOn(svc, 'computeAssociations').mockResolvedValue([
        baseAssoc({
          productA: a.id,
          productAName: 'Cafe',
          productB: lowStockB.id,
          productBName: 'Sucre',
          confidence: 0.9,
        }),
      ]);

      const res = await svc.getRecommendations(storeId, []);
      const alert = res.find((r) => r.type === 'alert');
      expect(alert).toBeDefined();
      expect(alert!.productId).toBe(lowStockB.id);
      expect(alert!.confidence).toBe(0.9);
      expect(alert!.actionability).toBe('immediate');
      expect(alert!.evidence).toContain('stock actuel: 2');
    });

    it('does NOT raise a stock alert for an INACTIVE associated product (alert query is active-scoped)', async () => {
      const storeId = await makeStore();
      const a = await makeProduct(storeId, { name: 'Cafe', stockQuantity: 100 });
      // Discontinued product, low stock — must be excluded from stock alerts.
      const inactiveLowB = await makeProduct(storeId, {
        name: 'Sucre',
        stockQuantity: 2,
        stockAlertThreshold: 5,
        isActive: false,
      });
      jest.spyOn(svc, 'computeAssociations').mockResolvedValue([
        baseAssoc({
          productA: a.id,
          productAName: 'Cafe',
          productB: inactiveLowB.id,
          productBName: 'Sucre',
          confidence: 0.9,
        }),
      ]);

      const res = await svc.getRecommendations(storeId, []);
      expect(res.find((r) => r.type === 'alert' && r.productId === inactiveLowB.id)).toBeUndefined();
    });

    it('does NOT raise a stock alert when the associated product is well stocked', async () => {
      const storeId = await makeStore();
      const a = await makeProduct(storeId, { name: 'Cafe', stockQuantity: 100 });
      const healthyB = await makeProduct(storeId, {
        name: 'Sucre',
        stockQuantity: 80,
        stockAlertThreshold: 5,
      });
      jest.spyOn(svc, 'computeAssociations').mockResolvedValue([
        baseAssoc({ productA: a.id, productB: healthyB.id, confidence: 0.9 }),
      ]);

      const res = await svc.getRecommendations(storeId, []);
      expect(res.find((r) => r.type === 'alert')).toBeUndefined();
    });

    it('applies a positive external-context boost that lifts a sub-threshold confidence over the line', async () => {
      const storeId = await makeStore();
      const a = await makeProduct(storeId, { name: 'Cafe', stockQuantity: 100 });
      const b = await makeProduct(storeId, { name: 'Sucre', stockQuantity: 100 });
      // Weather impactScore 1 → boost = 1 * 0.1 = 0.10. 0.70 + 0.10 = 0.80 >= 0.75.
      externalCtx.getFullContext.mockResolvedValue({
        weather: { available: true, impactScore: 1, description: 'Pluie', impactReason: 'froid' },
        transport: { available: false, impactScore: 0, hasDisruptions: false, impactReason: '' },
      });
      jest.spyOn(svc, 'computeAssociations').mockResolvedValue([
        baseAssoc({ productA: a.id, productB: b.id, confidence: 0.7 }),
      ]);

      const withBoost = await svc.getRecommendations(storeId, [
        { productId: a.id, name: 'Cafe' },
      ]);
      const upsell = withBoost.find((r) => r.type === 'upsell');
      expect(upsell).toBeDefined();
      expect(upsell!.confidence).toBeCloseTo(0.8, 5);
      // Weather evidence is threaded into the reco when impactScore != 0.
      expect(upsell!.evidence.some((e) => e.includes('Météo'))).toBe(true);
    });

    it('is fail-safe: an external-context failure neither boosts nor throws', async () => {
      const storeId = await makeStore();
      const a = await makeProduct(storeId, { name: 'Cafe', stockQuantity: 100 });
      const b = await makeProduct(storeId, { name: 'Sucre', stockQuantity: 100 });
      externalCtx.getFullContext.mockRejectedValue(new Error('weather API down'));
      jest.spyOn(svc, 'computeAssociations').mockResolvedValue([
        baseAssoc({ productA: a.id, productB: b.id, confidence: 0.9 }),
      ]);

      const res = await svc.getRecommendations(storeId, [
        { productId: a.id, name: 'Cafe' },
      ]);
      // Without boost, the 0.9 reco still passes the threshold and no throw escapes.
      expect(res.find((r) => r.type === 'upsell')).toBeDefined();
    });

    it('orders recommendations by confidence × actionability priority (immediate > watch)', async () => {
      const storeId = await makeStore();
      const a = await makeProduct(storeId, { name: 'Cafe', stockQuantity: 100 });
      const lowStockB = await makeProduct(storeId, {
        name: 'Sucre',
        stockQuantity: 2,
        stockAlertThreshold: 5,
      });
      jest.spyOn(svc, 'computeAssociations').mockResolvedValue([
        baseAssoc({
          productA: a.id,
          productAName: 'Cafe',
          productB: lowStockB.id,
          productBName: 'Sucre',
          confidence: 0.9,
        }),
      ]);

      const res = await svc.getRecommendations(storeId, [
        { productId: a.id, name: 'Cafe' },
      ]);
      // upsell (immediate, 3×0.9) and alert (immediate, 3×0.9) outrank insight (watch, 2×0.9).
      const lastType = res[res.length - 1].type;
      expect(lastType).toBe('insight');
      expect(['upsell', 'alert']).toContain(res[0].type);
    });
  });
});
