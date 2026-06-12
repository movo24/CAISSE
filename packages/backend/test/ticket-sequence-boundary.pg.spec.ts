/**
 * Real-Postgres twin of ticket-sequence-boundary.spec.ts (gated on
 * TEST_DATABASE_URL — skipped otherwise, so the pg-mem suite is unaffected).
 *
 * pg-mem proves the FIXED logic deterministically; this proves it against a
 * genuine Postgres, where the hazardous string collation that caused the bug
 * physically exists. The first assertion demonstrates that collation
 * (`T-1000000` < `T-999999` under `ORDER BY ticket_number DESC`) — i.e. the old
 * code WOULD mis-order here — then asserts the sale_seq-keyed generator is immune.
 *
 *   TEST_DATABASE_URL=postgresql://user@localhost:5432/caisse_fiscal_e2e \
 *     npx jest --forceExit test/ticket-sequence-boundary.pg.spec.ts
 */
import './helpers/env-setup';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { loadAllEntities } from './helpers/pgmem';
import { CacheModule } from '../src/common/cache/cache.module';
import { MessagingModule } from '../src/common/messaging/messaging.module';
import { RealtimeModule } from '../src/common/realtime/realtime.module';
import { TimewinModule } from '../src/modules/timewin/timewin.module';
import { SalesModule } from '../src/modules/sales/sales.module';
import { SalesService } from '../src/modules/sales/sales.service';
import { SaleEntity } from '../src/database/entities/sale.entity';
import { StoreEntity } from '../src/database/entities/store.entity';
import { ProductEntity } from '../src/database/entities/product.entity';

const TEST_DB = process.env.TEST_DATABASE_URL;
const d = TEST_DB ? describe : describe.skip;

const GENESIS = '0'.repeat(64);
const HASH_999999 = 'a'.repeat(64);
const HASH_1000000 = 'b'.repeat(64);

d('Ticket sequence boundary (real Postgres)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let sales: SalesService;

  const STORE_ID = uuidv4();
  const EMP_ID = uuidv4();
  const SNAP = { employeeName: 'Alice', employeeRole: 'admin', maxDiscount: 100 };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          type: 'postgres', url: TEST_DB, entities: loadAllEntities() as any, synchronize: true,
        }),
        CacheModule, MessagingModule, RealtimeModule, TimewinModule, SalesModule,
      ],
    }).compile();
    ds = moduleRef.get(DataSource);
    sales = moduleRef.get(SalesService);

    await ds.query(
      `TRUNCATE sales, sale_line_items, sale_payments, idempotency_keys RESTART IDENTITY CASCADE`,
    );
    await ds.getRepository(StoreEntity).save({ id: STORE_ID, name: 'S', storeCode: 'PGB', currencyCode: 'EUR', isActive: true } as any);
    await ds.getRepository(ProductEntity).save({
      id: uuidv4(), storeId: STORE_ID, ean: '5000000000001', name: 'Article 5€',
      priceMinorUnits: 500, taxRate: 20, stockQuantity: 1000, stockAlertThreshold: 5, stockCriticalThreshold: 2, isActive: true,
    } as any);
    await ds.getRepository(SaleEntity).save({
      id: uuidv4(), storeId: STORE_ID, employeeId: EMP_ID, status: 'completed',
      subtotalMinorUnits: 417, discountTotalMinorUnits: 0, taxTotalMinorUnits: 83, totalMinorUnits: 500,
      currencyCode: 'EUR', ticketNumber: 'T-999999', saleSeq: 999999,
      hashChainPrev: GENESIS, hashChainCurrent: HASH_999999, hashVersion: 2, completedAt: new Date(),
    } as any);
    await ds.getRepository(SaleEntity).save({
      id: uuidv4(), storeId: STORE_ID, employeeId: EMP_ID, status: 'completed',
      subtotalMinorUnits: 417, discountTotalMinorUnits: 0, taxTotalMinorUnits: 83, totalMinorUnits: 500,
      currencyCode: 'EUR', ticketNumber: 'T-1000000', saleSeq: 1000000,
      hashChainPrev: HASH_999999, hashChainCurrent: HASH_1000000, hashVersion: 2, completedAt: new Date(),
    } as any);
  });

  afterAll(async () => { await moduleRef?.close(); });

  it('real PG lexical collation DOES mis-order the ticket strings (the bug premise)', async () => {
    const lexHead = await ds.query(
      `SELECT ticket_number FROM sales WHERE store_id = $1 ORDER BY ticket_number DESC LIMIT 1`,
      [STORE_ID],
    );
    // Lexically 'T-999999' > 'T-1000000' (the '9' at index 2 beats '1'), so
    // `ORDER BY ticket_number DESC` returns the 999,999 row — exactly the wrong
    // head the OLD generator read past the boundary.
    expect(lexHead[0].ticket_number).toBe('T-999999');
  });

  it('sale_seq-keyed generator crosses the boundary correctly (T-1000001, chains onto T-1000000)', async () => {
    const dto = { items: [{ ean: '5000000000001', quantity: 1 }], payments: [{ method: 'cash', amountMinorUnits: 500 }] };
    const sale: any = await sales.createSale(STORE_ID, EMP_ID, dto as any, SNAP);

    expect(sale.ticketNumber).toBe('T-1000001');
    expect(Number(sale.saleSeq)).toBe(1000001);
    expect(sale.hashChainPrev).toBe(HASH_1000000);
    expect(sale.hashChainPrev).not.toBe(HASH_999999);
  });
});
