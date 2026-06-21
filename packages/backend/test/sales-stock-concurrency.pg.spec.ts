/**
 * Bloc 22 (POS mission) — CONCURRENT stock decrement on a REAL Postgres (gated
 * on TEST_DATABASE_URL; skipped otherwise). pg-mem is single-process and
 * mis-types GREATEST, so the real race — N terminals selling the last units at
 * once — can only be proven here: no oversell, stock never goes negative, and
 * exactly `stock` sales succeed.
 *
 *   TEST_DATABASE_URL=postgresql://user@localhost:5432/caisse_concurrency \
 *     npx jest --forceExit test/sales-stock-concurrency.pg.spec.ts
 */
import './helpers/env-setup';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { loadAllEntities } from './helpers/pgmem';
import { SalesModule } from '../src/modules/sales/sales.module';
import { CacheModule } from '../src/common/cache/cache.module';
import { MessagingModule } from '../src/common/messaging/messaging.module';
import { RealtimeModule } from '../src/common/realtime/realtime.module';
import { TimewinModule } from '../src/modules/timewin/timewin.module';
import { SalesService } from '../src/modules/sales/sales.service';
import { SaleEntity } from '../src/database/entities/sale.entity';
import { StoreEntity } from '../src/database/entities/store.entity';
import { ProductEntity } from '../src/database/entities/product.entity';

const TEST_DB = process.env.TEST_DATABASE_URL;
const d = TEST_DB ? describe : describe.skip;

d('Concurrent stock decrement (real Postgres)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let sales: SalesService;
  const STORE = uuidv4();
  const EMP = uuidv4();
  const EAN = '3000000000001';
  const snap = { employeeName: 'Alice', employeeRole: 'admin', maxDiscount: 100 };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({ type: 'postgres', url: TEST_DB, entities: loadAllEntities() as any, synchronize: true }),
        CacheModule, MessagingModule, RealtimeModule, TimewinModule, SalesModule,
      ],
    }).compile();
    ds = moduleRef.get(DataSource);
    sales = moduleRef.get(SalesService);
    await ds.getRepository(StoreEntity).save({ id: STORE, name: 'B43', storeCode: 'B43', currencyCode: 'EUR', isActive: true } as any);
    await ds.getRepository(ProductEntity).save({
      id: uuidv4(), storeId: STORE, ean: EAN, name: 'Café', priceMinorUnits: 500, taxRate: 20,
      stockQuantity: 5, stockAlertThreshold: 2, stockCriticalThreshold: 1, isActive: true,
    } as any);
  });
  afterAll(async () => {
    await moduleRef?.close();
  });

  it('DECISIVE — 10 concurrent 1-unit sales on stock=5: no oversell, stock floors at 0', async () => {
    const oneSale = (i: number) =>
      sales.createSale(
        STORE, EMP,
        { items: [{ ean: EAN, quantity: 1 }], payments: [{ method: 'cash', amountMinorUnits: 500 }] } as any,
        snap,
        `conc-${i}`,
      ).then(() => 'ok' as const).catch(() => 'rejected' as const);

    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => oneSale(i)));
    const ok = results.filter((r) => r === 'ok').length;

    const stock = (await ds.getRepository(ProductEntity).findOneByOrFail({ ean: EAN, storeId: STORE })).stockQuantity;
    expect(stock).toBeGreaterThanOrEqual(0); // NEVER negative
    expect(ok).toBe(5); // exactly the available units sold
    expect(stock).toBe(0);
    expect(await ds.getRepository(SaleEntity).count({ where: { storeId: STORE, status: 'completed' } })).toBe(5);
  });
});
