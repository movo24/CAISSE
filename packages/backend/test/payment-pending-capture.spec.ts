/**
 * Decision 6 — no "paid" without real card capture. A sale with an uncaptured
 * card leg (offline / TPE unconfirmed) is payment_pending (à régulariser), NOT
 * completed; the manager is alerted; it regularises when the card is really taken
 * and STAYS an anomaly if capture fails. Fixes the offline split-payment bug
 * (cash + uncaptured card must never be "paid").
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
import { SalePaymentEntity } from '../src/database/entities/sale-payment.entity';
import { StoreEntity } from '../src/database/entities/store.entity';
import { ProductEntity } from '../src/database/entities/product.entity';

describe('Decision 6 — payment_pending (no paid ticket without real capture)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let sales: SalesService;
  const STORE = uuidv4();
  const EMP = uuidv4();
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
    await ds.getRepository(StoreEntity).save({ id: STORE, name: 'B43', storeCode: 'B43', currencyCode: 'EUR', isActive: true } as any);
    await ds.getRepository(ProductEntity).save({
      id: uuidv4(), storeId: STORE, ean: '3000000000001', name: 'Café', priceMinorUnits: 1000, taxRate: 20,
      stockQuantity: 1000, stockAlertThreshold: 5, stockCriticalThreshold: 1, isActive: true,
    } as any);
  });
  afterAll(async () => {
    await moduleRef?.close();
  });

  // pg-mem mis-types GREATEST(0, stock-$1) so each sale zeroes stock — reset.
  beforeEach(async () => {
    await ds.getRepository(ProductEntity).update({ ean: '3000000000001', storeId: STORE }, { stockQuantity: 1000 });
  });

  const mixedSale = () => ({
    items: [{ ean: '3000000000001', quantity: 2 }], // 2000
    payments: [
      { method: 'cash', amountMinorUnits: 1000 },
      { method: 'card', amountMinorUnits: 1000, pendingCapture: true }, // NOT captured
    ],
  });

  it('DECISIVE — cash + uncaptured card → status payment_pending, NOT completed (the offline split bug)', async () => {
    const s: any = await sales.createSale(STORE, EMP, mixedSale() as any, snap, `pp-${uuidv4()}`);
    expect(s.status).toBe('payment_pending'); // never falsely "completed"
    const pays = await ds.getRepository(SalePaymentEntity).find({ where: { saleId: s.id } });
    expect(pays.find((p) => p.method === 'cash')!.captured).toBe(true);
    expect(pays.find((p) => p.method === 'card')!.captured).toBe(false);
    const pending = await sales.listPendingPayments(STORE);
    expect(pending.some((x) => x.id === s.id)).toBe(true);
  });

  it('DECISIVE — regularise (capture really taken) → sale becomes completed', async () => {
    const s: any = await sales.createSale(STORE, EMP, mixedSale() as any, snap, `pp2-${uuidv4()}`);
    const r = await sales.regularizePayment(s.id, STORE, EMP, { stripePaymentIntentId: 'pi_real', success: true });
    expect(r).toMatchObject({ regularized: true, status: 'completed' });
    const card = (await ds.getRepository(SalePaymentEntity).find({ where: { saleId: s.id } })).find((p) => p.method === 'card')!;
    expect(card.captured).toBe(true);
    expect(card.stripePaymentIntentId).toBe('pi_real');
  });

  it('DECISIVE — a FAILED capture leaves the sale payment_pending (anomaly), not paid', async () => {
    const s: any = await sales.createSale(STORE, EMP, mixedSale() as any, snap, `pp3-${uuidv4()}`);
    const r = await sales.regularizePayment(s.id, STORE, EMP, { success: false });
    expect(r).toMatchObject({ regularized: false, status: 'payment_pending' });
    expect((await sales.listPendingPayments(STORE)).some((x) => x.id === s.id)).toBe(true);
  });

  it('GO WisePad3 — an UNVERIFIED capture claim (Stripe not configured) degrades to payment_pending, never trusted as paid', async () => {
    // Before the GO WisePad3 hardening this exact dto was accepted as
    // "completed" on the client's word. Now: no Stripe client available to
    // verify pi_x → the claim is unverifiable → honest payment_pending.
    const dto = {
      items: [{ ean: '3000000000001', quantity: 1 }],
      payments: [{ method: 'card', amountMinorUnits: 1000, stripePaymentIntentId: 'pi_x' }], // claims captured
    };
    const s: any = await sales.createSale(STORE, EMP, dto as any, snap, `ok-${uuidv4()}`);
    expect(s.status).toBe('payment_pending');
    expect((await sales.listPendingPayments(STORE)).some((x) => x.id === s.id)).toBe(true);
  });
});
