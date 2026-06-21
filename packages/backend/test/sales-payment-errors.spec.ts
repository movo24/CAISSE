/**
 * Bloc 22 (POS mission) — payment/stock error paths on createSale. The Bloc 0
 * audit flagged these as untested: a sale must NOT finalize on an incoherent
 * payment (total not covered, no payment) or insufficient stock — and on
 * rejection NOTHING is persisted (no sale row, stock untouched).
 */
import './helpers/env-setup';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource, loadAllEntities } from './helpers/pgmem';
import { SalesModule } from '../src/modules/sales/sales.module';
import { CacheModule } from '../src/common/cache/cache.module';
import { MessagingModule } from '../src/common/messaging/messaging.module';
import { RealtimeModule } from '../src/common/realtime/realtime.module';
import { TimewinModule } from '../src/modules/timewin/timewin.module';
import { SalesService } from '../src/modules/sales/sales.service';
import { SaleEntity } from '../src/database/entities/sale.entity';
import { StoreEntity } from '../src/database/entities/store.entity';
import { ProductEntity } from '../src/database/entities/product.entity';

describe('Bloc 22 — createSale payment & stock error paths', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let sales: SalesService;
  const STORE = uuidv4();
  const EMP = uuidv4();
  const snap = { employeeName: 'Alice', employeeRole: 'admin', maxDiscount: 100 };

  const saleCount = () => ds.getRepository(SaleEntity).count({ where: { storeId: STORE } });
  const stockOf = async () =>
    (await ds.getRepository(ProductEntity).findOneByOrFail({ ean: '3000000000001', storeId: STORE })).stockQuantity;

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRootAsync({
          useFactory: () => ({ type: 'postgres', entities: loadAllEntities() as any, synchronize: true }),
          dataSourceFactory: async () => (dataSource.isInitialized ? dataSource : dataSource.initialize()),
        }),
        CacheModule,
        MessagingModule,
        RealtimeModule,
        TimewinModule,
        SalesModule,
      ],
    }).compile();
    ds = moduleRef.get(DataSource);
    sales = moduleRef.get(SalesService);

    await ds.getRepository(StoreEntity).save({ id: STORE, name: 'B43', storeCode: 'B43', currencyCode: 'EUR', isActive: true } as any);
    await ds.getRepository(ProductEntity).save({
      id: uuidv4(), storeId: STORE, ean: '3000000000001', name: 'Café', priceMinorUnits: 500, taxRate: 20,
      stockQuantity: 5, stockAlertThreshold: 2, stockCriticalThreshold: 1, isActive: true,
    } as any);
  });
  afterAll(async () => {
    await moduleRef?.close();
  });

  it('DECISIVE — payment under the total is rejected; no sale, stock untouched', async () => {
    const dto = { items: [{ ean: '3000000000001', quantity: 2 }], payments: [{ method: 'cash', amountMinorUnits: 500 }] }; // owe 1000
    await expect(sales.createSale(STORE, EMP, dto as any, snap)).rejects.toThrow(/< sale total/);
    expect(await saleCount()).toBe(0);
    expect(await stockOf()).toBe(5);
  });

  it('ADVERSE — a sale with no payment is rejected', async () => {
    const dto = { items: [{ ean: '3000000000001', quantity: 1 }], payments: [] };
    await expect(sales.createSale(STORE, EMP, dto as any, snap)).rejects.toThrow(/at least one payment/);
    expect(await saleCount()).toBe(0);
  });

  it('DECISIVE — insufficient stock is rejected before any write; stock untouched', async () => {
    const dto = { items: [{ ean: '3000000000001', quantity: 99 }], payments: [{ method: 'cash', amountMinorUnits: 49500 }] };
    await expect(sales.createSale(STORE, EMP, dto as any, snap)).rejects.toThrow(/Insufficient stock/);
    expect(await saleCount()).toBe(0);
    expect(await stockOf()).toBe(5);
  });

  it('a COHERENT sale then succeeds and decrements stock (control)', async () => {
    const before = await stockOf();
    const dto = { items: [{ ean: '3000000000001', quantity: 2 }], payments: [{ method: 'cash', amountMinorUnits: 1000 }] };
    const sale: any = await sales.createSale(STORE, EMP, dto as any, snap);
    expect(sale.status).toBe('completed');
    expect(await saleCount()).toBe(1);
    // Direction only: pg-mem mis-types GREATEST(0, stock - $1) (real PG is exact —
    // the exact decrement + concurrent oversell are proven in the gated .pg spec).
    expect(await stockOf()).toBeLessThan(before);
  });
});
