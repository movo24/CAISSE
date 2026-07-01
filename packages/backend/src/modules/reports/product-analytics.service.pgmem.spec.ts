import { DataSource, Repository } from 'typeorm';

import { createPgMemDataSource } from '../../../test/helpers/pgmem';
import { ProductAnalyticsService } from './product-analytics.service';
import { SaleEntity } from '../../database/entities/sale.entity';
import { SaleLineItemEntity } from '../../database/entities/sale-line-item.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { StoreEntity } from '../../database/entities/store.entity';

// PAQUET 274 — ProductAnalyticsService against a real in-memory Postgres (pg-mem):
// the actual query builders (units/revenue per product with completed+window+tenant
// predicates, last-sold MAX, daily CA series) are exercised, not mocked.
// Read-only service: no fiscal recomputation, no writes to sales.

const NOW = new Date('2026-06-15T12:00:00Z');
const d = (days: number, at = 'T10:00:00Z') =>
  new Date(new Date(NOW.getTime() - days * 86_400_000).toISOString().slice(0, 10) + at);

describe('ProductAnalyticsService (pg-mem)', () => {
  let dataSource: DataSource;
  let saleRepo: Repository<SaleEntity>;
  let lineRepo: Repository<SaleLineItemEntity>;
  let productRepo: Repository<ProductEntity>;
  let storeRepo: Repository<StoreEntity>;
  let service: ProductAnalyticsService;

  let storeId: string;
  let otherStoreId: string;
  let pStar: string; // sells recently and a lot
  let pDormant: string; // sold once, long ago

  async function seedSale(opts: {
    store: string;
    createdAt: Date;
    status?: string;
    ticket: string;
    lines: Array<{ productId: string; qty: number; lineTotal: number }>;
  }): Promise<void> {
    const sale = await saleRepo.save(
      saleRepo.create({
        storeId: opts.store,
        employeeId: 'emp-1',
        status: opts.status ?? 'completed',
        ticketNumber: opts.ticket,
        totalMinorUnits: opts.lines.reduce((s, l) => s + l.lineTotal, 0),
        createdAt: opts.createdAt,
      } as Partial<SaleEntity>),
    );
    for (const l of opts.lines) {
      await lineRepo.save(
        lineRepo.create({
          saleId: sale.id,
          productId: l.productId,
          productName: 'x',
          ean: 'e',
          quantity: l.qty,
          unitPriceMinorUnits: Math.round(l.lineTotal / l.qty),
          lineTotalMinorUnits: l.lineTotal,
        } as Partial<SaleLineItemEntity>),
      );
    }
  }

  beforeAll(async () => {
    const built = createPgMemDataSource();
    dataSource = built.dataSource;
    await dataSource.initialize();
    saleRepo = dataSource.getRepository(SaleEntity);
    lineRepo = dataSource.getRepository(SaleLineItemEntity);
    productRepo = dataSource.getRepository(ProductEntity);
    storeRepo = dataSource.getRepository(StoreEntity);
    service = new ProductAnalyticsService(saleRepo, lineRepo, productRepo, storeRepo);

    const store = await storeRepo.save(storeRepo.create({ name: 'Wesley Test', timezone: 'Europe/Paris' }));
    const other = await storeRepo.save(storeRepo.create({ name: 'Other', timezone: 'Europe/Paris' }));
    storeId = store.id;
    otherStoreId = other.id;

    const star = await productRepo.save(
      productRepo.create({ ean: '111', name: 'Star candy', priceMinorUnits: 250, stockQuantity: 50, storeId } as Partial<ProductEntity>),
    );
    const dormant = await productRepo.save(
      productRepo.create({ ean: '222', name: 'Dormant candy', priceMinorUnits: 400, stockQuantity: 5, storeId } as Partial<ProductEntity>),
    );
    pStar = star.id;
    pDormant = dormant.id;
    // Same-EAN product in the other store — its sales must never leak into storeId's report.
    const foreign = await productRepo.save(
      productRepo.create({ ean: '111', name: 'Star candy', priceMinorUnits: 250, stockQuantity: 9, storeId: otherStoreId } as Partial<ProductEntity>),
    );

    // Window [now-7, now): 2 sales of star (3+2 units, 750+500)
    await seedSale({ store: storeId, createdAt: d(2), ticket: 't1', lines: [{ productId: pStar, qty: 3, lineTotal: 750 }] });
    await seedSale({ store: storeId, createdAt: d(5), ticket: 't2', lines: [{ productId: pStar, qty: 2, lineTotal: 500 }] });
    // Window [now-30, now-7): 1 more sale of star (1 unit, 250)
    await seedSale({ store: storeId, createdAt: d(20), ticket: 't3', lines: [{ productId: pStar, qty: 1, lineTotal: 250 }] });
    // Previous window [now-60, now-30): dormant sold once (its last sale ever)
    await seedSale({ store: storeId, createdAt: d(45), ticket: 't4', lines: [{ productId: pDormant, qty: 4, lineTotal: 1600 }] });
    // Pending sale inside 7d — must be EXCLUDED everywhere (only 'completed' counts)
    await seedSale({ store: storeId, createdAt: d(1), status: 'pending', ticket: 't5', lines: [{ productId: pStar, qty: 99, lineTotal: 9900 }] });
    // Other store's sale inside 7d — tenant isolation
    await seedSale({ store: otherStoreId, createdAt: d(1), ticket: 't6', lines: [{ productId: foreign.id, qty: 7, lineTotal: 1750 }] });
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('aggregates units 7d/30d/prev30d and revenue 30d per product — completed sales only, tenant-scoped', async () => {
    const report = await service.getReport(storeId, NOW);
    const star = report.items.find((i) => i.productId === pStar)!;
    expect(star.unitsSold7d).toBe(5); // 3+2 (pending 99 excluded, other store excluded)
    expect(star.unitsSold30d).toBe(6); // +1 at d-20
    expect(star.revenue30dMinorUnits).toBe(1500); // 750+500+250
    const dormant = report.items.find((i) => i.productId === pDormant)!;
    expect(dormant.unitsSold30d).toBe(0);
    expect(dormant.trendPct).toBe(-100); // prev30d=4 (window [-60,-30)) → (0-4)/4
  });

  it('lastSoldAt reflects MAX(created_at) of completed sales (all periods)', async () => {
    const report = await service.getReport(storeId, NOW);
    const dormant = report.items.find((i) => i.productId === pDormant)!;
    expect(dormant.lastSoldAt).toBe(d(45).toISOString());
    const star = report.items.find((i) => i.productId === pStar)!;
    expect(star.lastSoldAt).toBe(d(2).toISOString()); // not the pending d-1 sale
  });

  it('never leaks the other store: its product/report is independent', async () => {
    const report = await service.getReport(storeId, NOW);
    expect(report.items).toHaveLength(2); // only the 2 products of storeId
    const other = await service.getReport(otherStoreId, NOW);
    const foreignItem = other.items.find((i) => i.unitsSold7d > 0)!;
    expect(foreignItem.unitsSold7d).toBe(7);
    expect(other.items).toHaveLength(1);
  });

  it('sales trend: daily CA bucketed on the store local day, forecast + comparisons present', async () => {
    const trend = await service.getSalesTrend(storeId, NOW);
    expect(trend.timeZone).toBe('Europe/Paris');
    // No completed sale on NOW's local day → today CA = 0; J-1 exists only as pending → baseline 0 too.
    expect(trend.comparisons.today.caMinorUnits).toBe(0);
    expect(trend.forecast).toHaveProperty('method');
    expect(trend.generatedAt).toBe(NOW.toISOString());
  });

  it('caches per store+day (TTL): second call same day does not rebuild', async () => {
    const first = await service.getSalesTrend(storeId, NOW);
    const later = await service.getSalesTrend(storeId, new Date(NOW.getTime() + 60_000));
    expect(later.generatedAt).toBe(first.generatedAt); // cached build reused
  });
});
