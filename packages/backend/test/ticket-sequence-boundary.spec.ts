/**
 * Regression — the 999,999 → 1,000,000 ticket boundary (chain-fork bug).
 *
 * `ticket_number` is a zero-padded string (`T-000006`). Ordering the hash chain
 * by it is LEXICAL, which equals numeric order only to 6 digits: at the
 * 1,000,000th sale `T-1000000` sorts BEFORE `T-999999` as text. The old code
 * (`ORDER BY ticket_number DESC LIMIT 1`) therefore read `T-999999` as the max →
 * (a) the generator recomputed 1000000 → DUPLICATE ticket, and (b) the prevHash
 * lookup linked onto `T-999999` instead of `T-1000000` → the fiscal chain FORKS.
 *
 * The fix keys the generator AND the chain head on a monotonic integer cursor
 * (`sale_seq`, ADR-012). This test seeds the two boundary rows and asserts the
 * next sale gets `T-1000001` and chains onto the `T-1000000` row — deterministic
 * here because integer ordering does not depend on string collation. Runs in the
 * default pg-mem suite (always-on); a real-Postgres twin lives in
 * `ticket-sequence-boundary.pg.spec.ts` where the lexical bug physically exists.
 */
import './helpers/env-setup'; // MUST be first — sets JWT secrets before module import
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { createPgMemDataSource, loadAllEntities } from './helpers/pgmem';
import { CacheModule } from '../src/common/cache/cache.module';
import { MessagingModule } from '../src/common/messaging/messaging.module';
import { RealtimeModule } from '../src/common/realtime/realtime.module';
import { TimewinModule } from '../src/modules/timewin/timewin.module';
import { SalesModule } from '../src/modules/sales/sales.module';
import { SalesService } from '../src/modules/sales/sales.service';
import { SaleEntity } from '../src/database/entities/sale.entity';
import { StoreEntity } from '../src/database/entities/store.entity';
import { ProductEntity } from '../src/database/entities/product.entity';

const GENESIS = '0'.repeat(64);
const HASH_999999 = 'a'.repeat(64);
const HASH_1000000 = 'b'.repeat(64);

describe('Ticket sequence — 999,999 → 1,000,000 boundary (chain integrity)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let sales: SalesService;

  const STORE_ID = uuidv4();
  const EMP_ID = uuidv4();
  const SNAP = { employeeName: 'Alice', employeeRole: 'admin', maxDiscount: 100 };

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRootAsync({
          useFactory: () => ({ type: 'postgres', entities: loadAllEntities() as any, synchronize: true }),
          dataSourceFactory: async () => (dataSource.isInitialized ? dataSource : dataSource.initialize()),
        }),
        CacheModule, MessagingModule, RealtimeModule, TimewinModule, SalesModule,
      ],
    }).compile();

    ds = moduleRef.get(DataSource);
    sales = moduleRef.get(SalesService);

    await ds.getRepository(StoreEntity).save({
      id: STORE_ID, name: 'Boutique', storeCode: 'BND-001', currencyCode: 'EUR', isActive: true,
    } as any);
    await ds.getRepository(ProductEntity).save({
      id: uuidv4(), storeId: STORE_ID, ean: '3000000000001', name: 'Café 250g',
      priceMinorUnits: 500, taxRate: 20, stockQuantity: 100,
      stockAlertThreshold: 10, stockCriticalThreshold: 3, isActive: true,
    } as any);

    // Seed the two boundary rows. Their sale_seq values straddle the 6-digit
    // edge; their ticket strings are what the OLD lexical sort mis-ordered.
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

  afterAll(async () => {
    await moduleRef?.close();
  });

  // A single createSale exercises both failure modes at once: the generator
  // (must yield T-1000001, not a duplicate T-1000000) and the chain head (must
  // link onto T-1000000, not the lexically-larger T-999999). One call only —
  // pg-mem mis-types GREATEST(0, stock-$1) and zeroes the stock after one
  // decrement (real PG is exact), so a second createSale can't run here.
  it('generates T-1000001 and chains onto T-1000000, not the lexically-larger T-999999', async () => {
    const dto = { items: [{ ean: '3000000000001', quantity: 1 }], payments: [{ method: 'cash', amountMinorUnits: 500 }] };
    const sale: any = await sales.createSale(STORE_ID, EMP_ID, dto as any, SNAP);

    // (a) Generator: numeric successor of 1,000,000 — never a duplicate.
    expect(sale.ticketNumber).toBe('T-1000001');
    expect(Number(sale.saleSeq)).toBe(1000001);
    const dupCount = await ds.getRepository(SaleEntity).count({ where: { storeId: STORE_ID, ticketNumber: 'T-1000000' } as any });
    expect(dupCount).toBe(1);

    // (b) Chain head: read by sale_seq DESC → predecessor is the T-1000000 row.
    // Under the old lexical sort this would have been HASH_999999 → a fork.
    expect(sale.hashChainPrev).toBe(HASH_1000000);
    expect(sale.hashChainPrev).not.toBe(HASH_999999);
  });
});
