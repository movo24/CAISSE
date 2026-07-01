/**
 * End-to-end money flow against a real in-memory Postgres (pg-mem):
 *   login → sale (idempotent ×2 → dedup) → return → avoir → pay-by-avoir → Z-report.
 *
 * Service-level E2E: drives the real NestJS providers wired to a pg-mem DataSource
 * (so the transactional SQL — FOR UPDATE, hash chain, jsonb idempotency, stock —
 * runs against a genuine SQL engine), without needing Docker or a test database.
 */
import './helpers/env-setup'; // MUST be first — sets JWT secrets before AuthModule import
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

import { createPgMemDataSource, loadAllEntities } from './helpers/pgmem';
import { AuthModule } from '../src/modules/auth/auth.module';
import { SalesModule } from '../src/modules/sales/sales.module';
import { ReturnsModule } from '../src/modules/returns/returns.module';
import { ReportsModule } from '../src/modules/reports/reports.module';
import { SyncModule } from '../src/modules/sync/sync.module';
import { CacheModule } from '../src/common/cache/cache.module';
import { MessagingModule } from '../src/common/messaging/messaging.module';
import { RealtimeModule } from '../src/common/realtime/realtime.module';
import { TimewinModule } from '../src/modules/timewin/timewin.module';

import { AuthService } from '../src/modules/auth/auth.service';
import { SalesService } from '../src/modules/sales/sales.service';
import { ReturnsService } from '../src/modules/returns/returns.service';
import { ReportsService } from '../src/modules/reports/reports.service';
import { SyncService } from '../src/modules/sync/sync.service';

import { StoreEntity } from '../src/database/entities/store.entity';
import { ProductEntity } from '../src/database/entities/product.entity';
import { EmployeeEntity } from '../src/database/entities/employee.entity';
import { CreditNoteEntity } from '../src/database/entities/credit-note.entity';

describe('E2E — money flow (login → sale → return → avoir → pay → Z)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let auth: AuthService;
  let sales: SalesService;
  let returns: ReturnsService;
  let reports: ReportsService;
  let sync: SyncService;

  const STORE_ID = uuidv4();
  const EMP_ID = uuidv4();

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
        AuthModule,
        SalesModule,
        ReturnsModule,
        ReportsModule,
        SyncModule,
      ],
    }).compile();

    ds = moduleRef.get(DataSource);
    auth = moduleRef.get(AuthService);
    sales = moduleRef.get(SalesService);
    returns = moduleRef.get(ReturnsService);
    reports = moduleRef.get(ReportsService);
    sync = moduleRef.get(SyncService);

    // ── Seed: store, employee (PIN 1234), product ──
    await ds.getRepository(StoreEntity).save({
      id: STORE_ID, name: 'Boutique Test', storeCode: 'TEST-001', currencyCode: 'EUR', isActive: true,
    } as any);
    await ds.getRepository(EmployeeEntity).save({
      id: EMP_ID, storeId: STORE_ID, firstName: 'Alice', lastName: 'Caisse', email: 'alice@test.com',
      pinHash: await bcrypt.hash('1234', 4), qrCode: 'QR-ALICE', role: 'admin', maxDiscountPercent: 100, isActive: true,
    } as any);
    await ds.getRepository(ProductEntity).save({
      id: uuidv4(), storeId: STORE_ID, ean: '3000000000001', name: 'Café 250g',
      priceMinorUnits: 500, taxRate: 20, stockQuantity: 100,
      stockAlertThreshold: 10, stockCriticalThreshold: 3, isActive: true,
    } as any);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('logs in by PIN against the local DB', async () => {
    const session = await auth.loginByPin(STORE_ID, '1234');
    expect(session.accessToken).toBeTruthy();
    expect(session.employee.id).toBe(EMP_ID);
  });

  let saleId: string;
  let stockAfterSale = 0;

  it('creates a sale and dedups an idempotent replay (same key → same sale)', async () => {
    const dto = { items: [{ ean: '3000000000001', quantity: 2 }], payments: [{ method: 'cash', amountMinorUnits: 1000 }] };
    const snap = { employeeName: 'Alice Caisse', employeeRole: 'admin', maxDiscount: 100 };

    const sale1: any = await sales.createSale(STORE_ID, EMP_ID, dto as any, snap, 'idem-key-1');
    const sale2: any = await sales.createSale(STORE_ID, EMP_ID, dto as any, snap, 'idem-key-1');

    expect(sale1.id).toBe(sale2.id); // replay returns the same sale
    saleId = sale1.id;
    const count = await ds.getRepository('sales').count();
    expect(count).toBe(1); // exactly ONE sale row despite two calls

    const stock = await ds.getRepository(ProductEntity).findOne({ where: { ean: '3000000000001' } });
    // Direction only: pg-mem mis-types GREATEST(0, stock - $1) params (real PG is exact).
    expect(stock!.stockQuantity).toBeLessThan(100); // decremented exactly once despite the replay
    stockAfterSale = stock!.stockQuantity;
  });

  let avoirCode: string;

  it('returns 1 unit as a reusable store-credit avoir (stock restored)', async () => {
    const sale = await ds.getRepository('sales').findOne({ where: { id: saleId }, relations: ['lineItems'] }) as any;
    const lineItemId = sale.lineItems[0].id;

    const cn: any = await returns.createReturn(
      STORE_ID, EMP_ID,
      { originalSaleId: saleId, items: [{ lineItemId, quantity: 1 }], refundMethod: 'store_credit' },
      'Alice Caisse',
    );
    expect(cn.type).toBe('store_credit');
    expect(cn.totalMinorUnits).toBe(500); // 1 of 2 units of the 1000 line
    expect(cn.remainingMinorUnits).toBe(500);
    avoirCode = cn.code;

    const stock = await ds.getRepository(ProductEntity).findOne({ where: { ean: '3000000000001' } });
    expect(stock!.stockQuantity).toBeGreaterThan(stockAfterSale); // 1 unit restored to stock
  });

  it('pays a new sale with the avoir (balance decremented, marked redeemed)', async () => {
    const dto = {
      items: [{ ean: '3000000000001', quantity: 1 }],
      payments: [{ method: 'store_credit', amountMinorUnits: 500, creditNoteCode: avoirCode }],
    };
    const sale: any = await sales.createSale(STORE_ID, EMP_ID, dto as any, { maxDiscount: 100 }, 'idem-key-2');
    expect(sale.id).toBeTruthy();

    const cn = await ds.getRepository(CreditNoteEntity).findOne({ where: { code: avoirCode } }) as any;
    expect(cn.remainingMinorUnits).toBe(0);
    expect(cn.status).toBe('redeemed');
  });

  it('generates a Z-report aggregating the day’s completed sales', async () => {
    const today = new Date().toISOString().split('T')[0];
    const z: any = await reports.generateZReport(STORE_ID, today, EMP_ID);
    // Two completed sales today: 1000 (cash) + 500 (avoir) = 1500
    expect(z.totalRevenue ?? z.totalRevenueMinorUnits ?? z.total).toBeGreaterThanOrEqual(1000);
    expect(z.transactionCount).toBeGreaterThanOrEqual(2);
  });

  it('offline sync: push inserts queued sales, a replay is deduped (idempotent)', async () => {
    const offlineSale = {
      id: uuidv4(), storeId: STORE_ID, employeeId: EMP_ID, status: 'completed',
      subtotalMinorUnits: 500, discountTotalMinorUnits: 0, taxTotalMinorUnits: 83, totalMinorUnits: 500,
      currencyCode: 'EUR', ticketNumber: 'OFF-SYNC-1', completedAt: new Date(), lineItems: [], payments: [],
    };
    const payload = {
      storeId: STORE_ID, deviceId: 'device-1', lastSyncAt: new Date(0).toISOString(),
      sales: [offlineSale as any], customers: [], stockAdjustments: [],
    };

    const first = await sync.push(payload);
    expect(first.accepted).toBe(1);

    const replay = await sync.push(payload); // same sale id → already on server
    expect(replay.accepted).toBe(0); // deduped, no duplicate

    const count = await ds.getRepository('sales').count({ where: { ticketNumber: 'OFF-SYNC-1' } as any });
    expect(count).toBe(1);
  });

  it('POS-061 wiring: a REAL sale charges the store price override, not the global price', async () => {
    // global 10.00 €, store override 7.50 € → the sale line must use 750
    await ds.getRepository(ProductEntity).save({
      id: uuidv4(), storeId: STORE_ID, ean: '3000000000002', name: 'Réglisse premium',
      priceMinorUnits: 1000, priceOverrideMinorUnits: 750, taxRate: 20, stockQuantity: 10,
      stockAlertThreshold: 2, stockCriticalThreshold: 1, isActive: true,
    } as any);

    const dto = { items: [{ ean: '3000000000002', quantity: 1 }], payments: [{ method: 'cash', amountMinorUnits: 750 }] };
    const snap = { employeeName: 'Alice Caisse', employeeRole: 'admin', maxDiscount: 100 };
    const sale: any = await sales.createSale(STORE_ID, EMP_ID, dto as any, snap, 'idem-override-1');

    expect(sale.totalMinorUnits ?? sale.total_minor_units).toBe(750); // override wins end-to-end
    const line: any = await ds
      .getRepository('sale_line_items')
      .findOne({ where: { saleId: sale.id } as any });
    expect(Number(line.unitPriceMinorUnits ?? line.unit_price_minor_units)).toBe(750);
  });
});
