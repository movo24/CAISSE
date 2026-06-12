/**
 * Étage 0 — stock projection refresh (INV-4). Canonical source = stock_balances
 * (per-location qty + thresholds), mapped to a store via stock_locations. Asserts
 * rupture (qty ≤ critical) and low-stock (critical < qty ≤ alert) counts per store.
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { OrganizationEntity } from '../src/database/entities/organization.entity';
import { StoreEntity } from '../src/database/entities/store.entity';
import { ProductEntity } from '../src/database/entities/product.entity';
import { StockLocationEntity } from '../src/database/entities/stock-location.entity';
import { StockBalanceEntity } from '../src/database/entities/stock-balance.entity';
import { AnalyticsStoreStockEntity } from '../src/database/entities/analytics-store-stock.entity';
import { StockProjectionRefreshService } from '../src/modules/analytics-projection/stock-projection-refresh.service';

describe('Étage 0 — stock projection refresh (INV-4)', () => {
  let ds: DataSource;
  let svc: StockProjectionRefreshService;
  const ORG = uuidv4();
  const STORE = uuidv4();
  const LOC = uuidv4();
  const P1 = uuidv4();
  const P2 = uuidv4();
  const P3 = uuidv4();

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();

    await ds.getRepository(OrganizationEntity).save({ id: ORG, name: 'Wesley' } as any);
    await ds.getRepository(StoreEntity).save({ id: STORE, name: 'Grand Littoral B43', organizationId: ORG, isActive: true, currencyCode: 'EUR' } as any);
    await ds.getRepository(StockLocationEntity).save({ id: LOC, name: 'Réserve B43', code: 'LOC-B43', storeId: STORE, isActive: true } as any);
    const prod = (id: string, ean: string) => ({ id, storeId: STORE, ean, name: `P-${ean}`, priceMinorUnits: 500, taxRate: 20 });
    await ds.getRepository(ProductEntity).save([prod(P1, '111'), prod(P2, '222'), prod(P3, '333')] as any);
    await ds.getRepository(StockBalanceEntity).save([
      { id: uuidv4(), productId: P1, locationId: LOC, quantity: 2, alertThreshold: 10, criticalThreshold: 5 }, // 2 ≤ 5 → rupture
      { id: uuidv4(), productId: P2, locationId: LOC, quantity: 8, alertThreshold: 10, criticalThreshold: 5 }, // 5 < 8 ≤ 10 → low
      { id: uuidv4(), productId: P3, locationId: LOC, quantity: 50, alertThreshold: 10, criticalThreshold: 5 }, // ok
    ] as any);

    svc = new StockProjectionRefreshService(
      ds.getRepository(StoreEntity),
      ds.getRepository(StockLocationEntity),
      ds.getRepository(StockBalanceEntity),
      ds.getRepository(AnalyticsStoreStockEntity),
    );
    await svc.refreshAll(new Date());
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('derives rupture + low-stock counts from stock_balances (per store, via locations)', async () => {
    const r = await ds.getRepository(AnalyticsStoreStockEntity).findOne({ where: { storeId: STORE } });
    expect(r).toBeTruthy();
    expect(r!.ruptureCount).toBe(1); // P1 (qty 2 ≤ critical 5)
    expect(r!.lowStockCount).toBe(1); // P2 (5 < qty 8 ≤ alert 10)
    expect(r!.computedAt).toBeTruthy();
  });

  it('idempotent: a second refresh keeps one row per store', async () => {
    await svc.refreshAll(new Date());
    expect(await ds.getRepository(AnalyticsStoreStockEntity).count({ where: { storeId: STORE } })).toBe(1);
  });
});
