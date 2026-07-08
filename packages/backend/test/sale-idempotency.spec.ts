/**
 * Online sale idempotency — a replayed create (double-click, network retry,
 * lost-response offline replay) with the SAME Idempotency-Key must NEVER create
 * a second sale / second cash-in. The first sale is authoritative; the replay
 * returns the cached ticket.
 */
import './helpers/env-setup';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { createPgMemDataSource, loadAllEntities } from './helpers/pgmem';
import { SalesModule } from '../src/modules/sales/sales.module';
import { ReturnsModule } from '../src/modules/returns/returns.module';
import { CacheModule } from '../src/common/cache/cache.module';
import { MessagingModule } from '../src/common/messaging/messaging.module';
import { RealtimeModule } from '../src/common/realtime/realtime.module';
import { TimewinModule } from '../src/modules/timewin/timewin.module';
import { SalesService } from '../src/modules/sales/sales.service';
import { SaleEntity } from '../src/database/entities/sale.entity';
import { StoreEntity } from '../src/database/entities/store.entity';
import { ProductEntity } from '../src/database/entities/product.entity';

const SNAP = { employeeName: 'Alice', employeeRole: 'admin', maxDiscount: 100 };

describe('Online sale idempotency (no double sale / double cash-in)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let sales: SalesService;
  const STORE = uuidv4();
  const EMP = uuidv4();
  const EAN = '5000000000001';
  const dto = () => ({ items: [{ ean: EAN, quantity: 1 }], payments: [{ method: 'cash', amountMinorUnits: 500 }] });
  // pg-mem mis-evaluates `GREATEST(0, stock_quantity - $1)` with a bound param and
  // zeroes stock on every sale (real Postgres is unaffected). Reseed so stock never
  // gates the idempotency assertions we actually care about.
  const seedStock = (q = 1000) =>
    ds.getRepository(ProductEntity).update({ storeId: STORE, ean: EAN }, { stockQuantity: q });

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRootAsync({
          useFactory: () => ({ type: 'postgres', entities: loadAllEntities() as any, synchronize: true }),
          dataSourceFactory: async () => (dataSource.isInitialized ? dataSource : dataSource.initialize()),
        }),
        CacheModule, MessagingModule, RealtimeModule, TimewinModule, SalesModule, ReturnsModule,
      ],
    }).compile();
    ds = moduleRef.get(DataSource);
    sales = moduleRef.get(SalesService);
    await ds.getRepository(StoreEntity).save({ id: STORE, name: 'S', storeCode: 'S1', currencyCode: 'EUR', isActive: true } as any);
    await ds.getRepository(ProductEntity).save({
      id: uuidv4(), storeId: STORE, ean: EAN, name: 'Article 5€',
      priceMinorUnits: 500, taxRate: 20, stockQuantity: 1000, stockAlertThreshold: 5, stockCriticalThreshold: 2, isActive: true,
    } as any);
  });

  afterAll(async () => { await moduleRef?.close(); });

  it('same key twice → one sale row, second call replays the cached ticket', async () => {
    await seedStock();
    const key = `sale-${uuidv4()}`;
    const first: any = await sales.createSale(STORE, EMP, dto() as any, SNAP, key);
    const second: any = await sales.createSale(STORE, EMP, dto() as any, SNAP, key);

    expect(second.ticketNumber).toBe(first.ticketNumber); // replay, not a new ticket
    const rows = await ds.getRepository(SaleEntity).find({ where: { storeId: STORE } });
    expect(rows.length).toBe(1); // exactly ONE sale persisted
  });

  it('distinct keys → distinct sales', async () => {
    await seedStock();
    const a: any = await sales.createSale(STORE, EMP, dto() as any, SNAP, `sale-${uuidv4()}`);
    await seedStock();
    const b: any = await sales.createSale(STORE, EMP, dto() as any, SNAP, `sale-${uuidv4()}`);
    expect(b.ticketNumber).not.toBe(a.ticketNumber);
  });
});
