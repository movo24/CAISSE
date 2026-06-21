/**
 * Decision 5 — variants / SKU. A variant is a product row with a parent link, so
 * it has its own ean / sku / price / stock / active, and SELLS through the
 * unchanged sale path (its barcode is just another product EAN). Simple products
 * (parent_product_id NULL) are untouched.
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
import { StoreEntity } from '../src/database/entities/store.entity';
import { ProductEntity } from '../src/database/entities/product.entity';

describe('Decision 5 — product variants / SKU', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let sales: SalesService;
  let products: ProductsService;
  const STORE = uuidv4();
  const EMP = uuidv4();
  let parentId: string;
  const snap = { employeeName: 'Alice', employeeRole: 'admin', maxDiscount: 100 };
  const prodRepo = () => ds.getRepository(ProductEntity);

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
    const parent = await products.create(
      { ean: '3000000000001', name: 'Sac', priceMinorUnits: 2000, taxRate: 20, stockQuantity: 0, storeId: STORE } as any,
      EMP,
    );
    parentId = parent.id;
  });
  afterAll(async () => {
    await moduleRef?.close();
  });

  it('DECISIVE — a product can hold multiple variants, each with its own ean/sku/price/stock', async () => {
    const red = await products.createVariant(parentId, STORE, { ean: '3000000000018', variantName: 'Rouge', sku: 'SAC-RED', priceMinorUnits: 2200, stockQuantity: 5 }, EMP);
    const blue = await products.createVariant(parentId, STORE, { ean: '3000000000025', variantName: 'Bleu', sku: 'SAC-BLUE', priceMinorUnits: 2000, stockQuantity: 3 }, EMP);
    expect(red.parentProductId).toBe(parentId);
    expect(red.name).toBe('Sac — Rouge');
    expect(red.priceMinorUnits).toBe(2200);
    const variants = await products.listVariants(parentId, STORE);
    expect(variants.map((v) => v.sku).sort()).toEqual(['SAC-BLUE', 'SAC-RED']);
    expect(blue.taxRate).toBe(red.taxRate); // inherited from parent
  });

  it('DECISIVE — selling a variant by its barcode uses ITS price and decrements ITS stock (unchanged sale path)', async () => {
    const red = await products.findByEan('3000000000018', STORE);
    const dto = { items: [{ ean: '3000000000018', quantity: 2 }], payments: [{ method: 'cash', amountMinorUnits: 4400 }] };
    const sale: any = await sales.createSale(STORE, EMP, dto as any, snap, `var-${uuidv4()}`);
    expect(sale.totalMinorUnits).toBe(4400); // 2 × 2200 (the RED variant price)

    expect((await prodRepo().findOneByOrFail({ id: red!.id })).stockQuantity).toBeLessThan(5); // RED decremented
    const blue = await products.findByEan('3000000000025', STORE);
    expect(blue!.stockQuantity).toBe(3); // BLUE untouched
  });

  it('topLevelOnly lists parents/simple products, excluding variants', async () => {
    const all = await products.findAll(STORE, {});
    const top = await products.findAll(STORE, { topLevelOnly: true });
    expect(all.data.length).toBeGreaterThan(top.data.length); // variants present in all, absent in top-level
    expect(top.data.every((p) => p.parentProductId == null)).toBe(true);
  });

  it('ADVERSE — duplicate ean/sku, missing fields, and variant-of-variant are rejected', async () => {
    await expect(products.createVariant(parentId, STORE, { ean: '3000000000018', variantName: 'X', priceMinorUnits: 100 }, EMP)).rejects.toThrow(/EAN already used/);
    await expect(products.createVariant(parentId, STORE, { ean: '3000000000099', variantName: 'Y', sku: 'SAC-RED', priceMinorUnits: 100 }, EMP)).rejects.toThrow(/SKU already used/);
    await expect(products.createVariant(parentId, STORE, { ean: '', variantName: 'Z', priceMinorUnits: 100 }, EMP)).rejects.toThrow(/ean is required/);
    const red = await products.findByEan('3000000000018', STORE);
    await expect(products.createVariant(red!.id, STORE, { ean: '3000000000200', variantName: 'nested', priceMinorUnits: 100 }, EMP)).rejects.toThrow(/variant of a variant/);
  });
});
