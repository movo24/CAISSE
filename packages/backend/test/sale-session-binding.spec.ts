/**
 * Sale → POS session binding (reliability-first).
 *
 * A sale is tied to the terminal's ACTIVE session, resolved SERVER-SIDE from
 * (storeId, terminalId) and only when that session belongs to the acting
 * employee. It is never bound on the word of the client. When no valid session
 * is resolvable the sale still persists with a NULL binding — an auditable
 * "session unknown", not a fabricated link.
 *
 * Critically, the new columns live OUTSIDE the fiscal hash fingerprint, so the
 * v2 hash is unchanged (asserted below) and existing validated tickets stay
 * valid.
 */
import './helpers/env-setup';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';

import { createPgMemDataSource, loadAllEntities } from './helpers/pgmem';
import { SalesModule } from '../src/modules/sales/sales.module';
import { ReturnsModule } from '../src/modules/returns/returns.module';
import { CacheModule } from '../src/common/cache/cache.module';
import { MessagingModule } from '../src/common/messaging/messaging.module';
import { RealtimeModule } from '../src/common/realtime/realtime.module';
import { TimewinModule } from '../src/modules/timewin/timewin.module';
import { SalesService } from '../src/modules/sales/sales.service';
import { StoreEntity } from '../src/database/entities/store.entity';
import { ProductEntity } from '../src/database/entities/product.entity';
import { PosSessionEntity } from '../src/database/entities/pos-session.entity';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const GENESIS = '0'.repeat(64);
const TERMINAL = 'TERMINAL 02';
const EAN = '5000000000001';
const SNAP = { employeeName: 'Alice', employeeRole: 'admin', maxDiscount: 100 };
const DTO = { items: [{ ean: EAN, quantity: 1 }], payments: [{ method: 'card', amountMinorUnits: 500 }] };

describe('Sale → POS session binding', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let sales: SalesService;

  /** Seed an isolated store + product + (optionally) an active session. */
  async function seed(opts: { sessionEmp?: string; sessionTerminal?: string } = {}) {
    const storeId = uuidv4();
    const empId = uuidv4();
    await ds.getRepository(StoreEntity).save({ id: storeId, name: 'S', storeCode: `S-${storeId.slice(0, 8)}`, currencyCode: 'EUR', isActive: true } as any);
    await ds.getRepository(ProductEntity).save({
      id: uuidv4(), storeId, ean: EAN, name: 'Article 5€',
      priceMinorUnits: 500, taxRate: 20, stockQuantity: 1000, stockAlertThreshold: 5, stockCriticalThreshold: 2, isActive: true,
    } as any);
    let sessionId: string | null = null;
    if (opts.sessionEmp && opts.sessionTerminal) {
      const s = await ds.getRepository(PosSessionEntity).save({
        storeId, employeeId: opts.sessionEmp, terminalId: opts.sessionTerminal,
        employeeName: 'Alice', employeeRole: 'admin', isActive: true,
      } as any);
      sessionId = s.id;
    }
    return { storeId, empId, sessionId };
  }

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
  });

  afterAll(async () => { await moduleRef?.close(); });

  it('binds the sale to the terminal active session (server-side)', async () => {
    const { storeId, empId, sessionId } = await seed({ sessionEmp: undefined });
    const s = await ds.getRepository(PosSessionEntity).save({
      storeId, employeeId: empId, terminalId: TERMINAL, employeeName: 'Alice', employeeRole: 'admin', isActive: true,
    } as any);
    const sale: any = await sales.createSale(storeId, empId, DTO as any, SNAP, undefined, TERMINAL);
    expect(sale.terminalId).toBe(TERMINAL);
    expect(sale.sessionId).toBe(s.id);
    void sessionId;
  });



  it('records the terminal but leaves session null when no active session matches', async () => {
    const { storeId, empId } = await seed({ sessionEmp: uuidv4(), sessionTerminal: TERMINAL });
    // Ring on a DIFFERENT terminal than the one holding the active session.
    const sale: any = await sales.createSale(storeId, empId, DTO as any, SNAP, undefined, 'TERMINAL 99');
    expect(sale.terminalId).toBe('TERMINAL 99');
    expect(sale.sessionId).toBeNull();
  });

  it('does not bind a session that belongs to another employee', async () => {
    const { storeId, empId } = await seed();
    // Active session on TERMINAL belongs to a DIFFERENT employee.
    await ds.getRepository(PosSessionEntity).save({
      storeId, employeeId: uuidv4(), terminalId: TERMINAL, employeeName: 'Bob', employeeRole: 'cashier', isActive: true,
    } as any);
    const sale: any = await sales.createSale(storeId, empId, DTO as any, SNAP, undefined, TERMINAL);
    expect(sale.terminalId).toBe(TERMINAL);
    expect(sale.sessionId).toBeNull();
  });

  it('leaves both null when no terminal is provided (offline/by-ticket resilience)', async () => {
    const { storeId, empId } = await seed();
    await ds.getRepository(PosSessionEntity).save({
      storeId, employeeId: empId, terminalId: TERMINAL, employeeName: 'Alice', employeeRole: 'admin', isActive: true,
    } as any);
    const sale: any = await sales.createSale(storeId, empId, DTO as any, SNAP);
    expect(sale.terminalId).toBeNull();
    expect(sale.sessionId).toBeNull();
  });

  it('the binding is OUTSIDE the fiscal hash — v2 fingerprint (no session fields) still reproduces the stored hash', async () => {
    const { storeId, empId } = await seed();
    await ds.getRepository(PosSessionEntity).save({
      storeId, employeeId: empId, terminalId: TERMINAL, employeeName: 'Alice', employeeRole: 'admin', isActive: true,
    } as any);
    const sale: any = await sales.createSale(storeId, empId, DTO as any, SNAP, undefined, TERMINAL);

    expect(sale.sessionId).not.toBeNull(); // it IS bound…
    const v2Payload = JSON.stringify({
      v: 2,
      ticketNumber: sale.ticketNumber,
      storeId,
      employeeId: empId,
      customerId: sale.customerId ?? null,
      subtotalMinorUnits: sale.subtotalMinorUnits,
      discountTotalMinorUnits: sale.discountTotalMinorUnits,
      taxTotalMinorUnits: sale.taxTotalMinorUnits,
      totalAfterDiscount: sale.totalMinorUnits,
      payments: [{ method: 'card', amount: 500 }],
      completedAt: new Date(sale.completedAt).toISOString(),
      items: sale.lineItems.map((li: any) => ({ ean: li.ean, qty: li.quantity, total: li.lineTotalMinorUnits })),
    });
    // …yet the hash — which omits session_id/terminal_id — still matches (first sale of a fresh store → genesis prev).
    expect(sale.hashChainPrev).toBe(GENESIS);
    expect(sale.hashChainCurrent).toBe(sha256(GENESIS + v2Payload));
    expect(sale.hashVersion).toBe(2);
  });
});
