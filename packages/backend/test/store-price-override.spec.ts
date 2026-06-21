/**
 * Decision 4 — per-store price override. The product price is the default; an
 * active override wins (within its optional window), and it applies AT SALE (line
 * total, sale total, fiscal hash). Every change is historised.
 */
import './helpers/env-setup';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource, loadAllEntities } from './helpers/pgmem';
import { SalesModule } from '../src/modules/sales/sales.module';
import { ProductsModule } from '../src/modules/products/products.module';
import { CacheModule } from '../src/common/cache/cache.module';
import { MessagingModule } from '../src/common/messaging/messaging.module';
import { RealtimeModule } from '../src/common/realtime/realtime.module';
import { TimewinModule } from '../src/modules/timewin/timewin.module';
import { SalesService } from '../src/modules/sales/sales.service';
import { ProductsService } from '../src/modules/products/products.service';
import { SaleEntity } from '../src/database/entities/sale.entity';
import { StoreEntity } from '../src/database/entities/store.entity';
import { ProductEntity } from '../src/database/entities/product.entity';
import { PriceHistoryEntity } from '../src/database/entities/price-history.entity';

describe('Decision 4 — per-store price override', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let sales: SalesService;
  let products: ProductsService;
  const STORE = uuidv4();
  const EMP = uuidv4();
  let productId: string;
  const snap = { employeeName: 'Alice', employeeRole: 'admin', maxDiscount: 100 };

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRootAsync({
          useFactory: () => ({ type: 'postgres', entities: loadAllEntities() as any, synchronize: true }),
          dataSourceFactory: async () => (dataSource.isInitialized ? dataSource : dataSource.initialize()),
        }),
        CacheModule, MessagingModule, RealtimeModule, TimewinModule, ProductsModule, SalesModule,
      ],
    }).compile();
    ds = moduleRef.get(DataSource);
    sales = moduleRef.get(SalesService);
    products = moduleRef.get(ProductsService);

    await ds.getRepository(StoreEntity).save({ id: STORE, name: 'B43', storeCode: 'B43', currencyCode: 'EUR', isActive: true } as any);
    const p = await ds.getRepository(ProductEntity).save({
      id: uuidv4(), storeId: STORE, ean: '3000000000001', name: 'Café', priceMinorUnits: 500, taxRate: 20,
      stockQuantity: 100, stockAlertThreshold: 5, stockCriticalThreshold: 1, isActive: true,
    } as any);
    productId = p.id;
  });
  afterAll(async () => {
    await moduleRef?.close();
  });

  it('resolveEffectivePrice: base by default, override when active, base again when window not yet open', async () => {
    const base = await ds.getRepository(ProductEntity).findOneByOrFail({ id: productId });
    expect(await products.resolveEffectivePrice(base)).toBe(500); // no override → base

    await products.setStoreOverride(STORE, productId, 650, EMP);
    expect(await products.resolveEffectivePrice(base)).toBe(650); // active override wins

    // a future-windowed override does not apply yet
    await products.setStoreOverride(STORE, productId, 800, EMP, { startsAt: new Date(Date.now() + 86_400_000) });
    expect(await products.resolveEffectivePrice(base)).toBe(500); // window not open → base
  });

  it('DECISIVE — the override applies AT SALE (line + total reflect it), then base after clear', async () => {
    await products.setStoreOverride(STORE, productId, 650, EMP); // active now
    const dto = { items: [{ ean: '3000000000001', quantity: 2 }], payments: [{ method: 'cash', amountMinorUnits: 1300 }] };
    const sale: any = await sales.createSale(STORE, EMP, dto as any, snap, `ov-${uuidv4()}`);
    expect(sale.totalMinorUnits).toBe(1300); // 2 × 650 (override), not 2 × 500
    const lines = await ds.getRepository('sale_line_items' as any).find({ where: { saleId: sale.id } } as any);
    expect(lines[0].unitPriceMinorUnits ?? lines[0].unit_price_minor_units).toBe(650);

    await products.clearStoreOverride(STORE, productId, EMP);
    const base = await ds.getRepository(ProductEntity).findOneByOrFail({ id: productId });
    expect(await products.resolveEffectivePrice(base)).toBe(500); // back to base
  });

  it('every override change is historised (price_history, source store_override)', async () => {
    const hist = await ds.getRepository(PriceHistoryEntity).find({ where: { productId } });
    const overrideRows = hist.filter((h) => h.changeSource === 'store_override');
    expect(overrideRows.length).toBeGreaterThanOrEqual(2); // at least set + clear
    expect(overrideRows.some((h) => h.newPriceMinorUnits === 650)).toBe(true);
  });

  it('ADVERSE — a negative override price is rejected', async () => {
    await expect(products.setStoreOverride(STORE, productId, -1, EMP)).rejects.toThrow(/≥ 0/);
  });
});
