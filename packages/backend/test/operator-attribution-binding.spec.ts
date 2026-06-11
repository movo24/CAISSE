/**
 * (1b) operator-attribution binding — the two tests that PROVE the brick.
 *
 * (1) NON-AUTHORITY: when the active session's operator differs from the JWT
 *     operator, the hashed/exported employee_id stays the JWT value on every
 *     door. The session operator is recorded ONLY in the side-table. The
 *     divergence is the v3-decision signal — observed, never authoritative.
 *
 * (2) #7 CORRECTNESS: a return done at terminal B (session operator B) on a
 *     sale made at terminal A is attributed to B — the operator AT RETURN
 *     TIME — never inherited from the original sale's operator A.
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
import { PosSessionModule } from '../src/modules/pos-session/pos-session.module';
import { OperatorAttributionModule } from '../src/modules/operator-attribution/operator-attribution.module';
import { CacheModule } from '../src/common/cache/cache.module';
import { MessagingModule } from '../src/common/messaging/messaging.module';
import { RealtimeModule } from '../src/common/realtime/realtime.module';
import { TimewinModule } from '../src/modules/timewin/timewin.module';
import { SalesService } from '../src/modules/sales/sales.service';
import { ReturnsService } from '../src/modules/returns/returns.service';
import { PosSessionService } from '../src/modules/pos-session/pos-session.service';
import { OperatorAttributionService } from '../src/modules/operator-attribution/operator-attribution.service';
import { StoreEntity } from '../src/database/entities/store.entity';
import { ProductEntity } from '../src/database/entities/product.entity';

describe('(1b) operator-attribution binding', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let sales: SalesService;
  let returns: ReturnsService;
  let sessions: PosSessionService;
  let attribution: OperatorAttributionService;

  const STORE = uuidv4();
  const EMP_JWT = uuidv4(); // the request's JWT operator (authoritative)
  const EMP_SESSION = uuidv4(); // a DIFFERENT operator on the terminal session
  const SNAP = { employeeName: 'Jwt', employeeRole: 'admin', maxDiscount: 100 };

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRootAsync({
          useFactory: () => ({ type: 'postgres', entities: loadAllEntities() as any, synchronize: true }),
          dataSourceFactory: async () => (dataSource.isInitialized ? dataSource : dataSource.initialize()),
        }),
        CacheModule, MessagingModule, RealtimeModule, TimewinModule,
        SalesModule, ReturnsModule, PosSessionModule, OperatorAttributionModule,
      ],
    }).compile();
    ds = moduleRef.get(DataSource);
    sales = moduleRef.get(SalesService);
    returns = moduleRef.get(ReturnsService);
    sessions = moduleRef.get(PosSessionService);
    attribution = moduleRef.get(OperatorAttributionService);

    await ds.getRepository(StoreEntity).save({ id: STORE, name: 'S', storeCode: 'S1', currencyCode: 'EUR', isActive: true } as any);
    await ds.getRepository(ProductEntity).save({
      id: uuidv4(), storeId: STORE, ean: '5000000000001', name: 'Article 5€',
      priceMinorUnits: 500, taxRate: 20, stockQuantity: 1000, stockAlertThreshold: 5, stockCriticalThreshold: 2, isActive: true,
    } as any);
  });

  afterAll(async () => { await moduleRef?.close(); });

  const freshStock = () => ds.getRepository(ProductEntity).update({ storeId: STORE }, { stockQuantity: 1000 });

  it('NON-AUTHORITY: hashed sale.employee_id stays JWT; session operator only in side-table', async () => {
    // Active session on Caisse-1 belongs to EMP_SESSION (≠ EMP_JWT).
    await sessions.openSession(STORE, EMP_SESSION, SNAP, { terminalId: 'Caisse-1' });

    await freshStock();
    const dto = { items: [{ ean: '5000000000001', quantity: 1 }], payments: [{ method: 'card', amountMinorUnits: 500 }] };
    // The request is authenticated as EMP_JWT, terminal claims Caisse-1.
    const sale: any = await sales.createSale(STORE, EMP_JWT, dto as any, SNAP, undefined, 'Caisse-1');

    // The hashed/authoritative operator is the JWT value — NOT the session's.
    expect(sale.employeeId).toBe(EMP_JWT);

    // The session operator is recorded only as a non-authoritative observation.
    const att = await attribution.findByEvent('sale', sale.id);
    expect(att?.sessionOperatorId).toBe(EMP_SESSION);
    expect(att?.sessionTerminalId).toBe('Caisse-1');
    expect(att?.attributionSource).toBe('session');

    // Divergence is measured (the v3-decision signal): JWT ≠ session.
    const d = await attribution.saleDivergenceForStore(STORE);
    expect(d.diverged).toBeGreaterThanOrEqual(1);
  });

  it('no_session: a sale with an unregistered/absent terminal session still completes (never blocks)', async () => {
    await freshStock();
    const dto = { items: [{ ean: '5000000000001', quantity: 1 }], payments: [{ method: 'card', amountMinorUnits: 500 }] };
    const sale: any = await sales.createSale(STORE, EMP_JWT, dto as any, SNAP, undefined, 'Caisse-UNKNOWN');
    expect(sale.id).toBeTruthy(); // sale completed despite no session
    const att = await attribution.findByEvent('sale', sale.id);
    expect(att?.attributionSource).toBe('no_session');
    expect(att?.sessionOperatorId).toBeNull();
  });

  it('#7 CORRECTNESS: return at terminal B is attributed to B, never the original sale operator A', async () => {
    // Sale made at terminal A by operator A.
    await sessions.openSession(STORE, EMP_SESSION, SNAP, { terminalId: 'Term-A' }).catch(() => {});
    const OP_A = uuidv4();
    await sessions.openSession(STORE, OP_A, SNAP, { terminalId: 'Term-A' }).catch(() => {});
    await freshStock();
    const saleDto = { items: [{ ean: '5000000000001', quantity: 1 }], payments: [{ method: 'card', amountMinorUnits: 500 }] };
    const sale: any = await sales.createSale(STORE, OP_A, saleDto as any, SNAP, undefined, 'Term-A');

    // A DIFFERENT operator B holds terminal B and does the return.
    const OP_B = uuidv4();
    await sessions.openSession(STORE, OP_B, SNAP, { terminalId: 'Term-B' });
    const cn: any = await returns.createReturn(
      STORE,
      OP_B, // the return request's JWT operator
      { originalSaleId: sale.id, items: [{ lineItemId: sale.lineItems[0].id, quantity: 1 }], refundMethod: 'store_credit' } as any,
      'B',
      undefined,
      'Term-B', // return terminal
    );

    const att = await attribution.findByEvent('return', cn.id);
    // Attributed to the RETURN operator/terminal — never the original sale's.
    expect(att?.sessionOperatorId).toBe(OP_B);
    expect(att?.sessionTerminalId).toBe('Term-B');
    expect(att?.sessionOperatorId).not.toBe(OP_A);
  });
});
