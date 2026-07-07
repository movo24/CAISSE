/**
 * Cash count at session close — attendu SERVEUR vs compté RÉEL.
 *
 * The expected cash is derived server-side from the session's own cash sales
 * (bound via session_id) plus the declared opening float. The counted value is
 * the only figure from the client; the écart is computed and, when material,
 * classified into a CASH_DIFFERENCE_* score event tied to the session, the
 * terminal and the employee. Nothing is invented: an uncounted close leaves the
 * cash fields null.
 */
import './helpers/env-setup';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { createPgMemDataSource, loadAllEntities } from './helpers/pgmem';
import { SalesModule } from '../src/modules/sales/sales.module';
import { ReturnsModule } from '../src/modules/returns/returns.module';
import { PosSessionModule } from '../src/modules/pos-session/pos-session.module';
import { CacheModule } from '../src/common/cache/cache.module';
import { MessagingModule } from '../src/common/messaging/messaging.module';
import { RealtimeModule } from '../src/common/realtime/realtime.module';
import { TimewinModule } from '../src/modules/timewin/timewin.module';
import { SalesService } from '../src/modules/sales/sales.service';
import { PosSessionService } from '../src/modules/pos-session/pos-session.service';
import { StoreEntity } from '../src/database/entities/store.entity';
import { ProductEntity } from '../src/database/entities/product.entity';
import { EmployeeScoreEventEntity } from '../src/database/entities/employee-score-event.entity';
import { getRepositoryToken } from '@nestjs/typeorm';

const SNAP = { employeeName: 'Alice', employeeRole: 'admin', maxDiscount: 100 };
const EANS = ['5000000000001', '5000000000002', '5000000000003', '5000000000004'];

describe('POS session cash count (attendu serveur vs compté réel)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let sales: SalesService;
  let sessions: PosSessionService;
  let scoreEvents: Repository<EmployeeScoreEventEntity>;

  /** Fresh isolated store + one product per EAN (distinct product per sale to
   *  avoid pg-mem single-row stock coupling; cash aggregation is by session). */
  async function seedStore() {
    const storeId = uuidv4();
    await ds.getRepository(StoreEntity).save({ id: storeId, name: 'S', storeCode: `S-${storeId.slice(0, 8)}`, currencyCode: 'EUR', isActive: true } as any);
    for (const ean of EANS) {
      await ds.getRepository(ProductEntity).save({
        id: uuidv4(), storeId, ean, name: `Article ${ean}`,
        priceMinorUnits: 500, taxRate: 20, stockQuantity: 1000, stockAlertThreshold: 5, stockCriticalThreshold: 2, isActive: true,
      } as any);
    }
    return storeId;
  }

  /** A cash sale of 500 centimes on the i-th product (distinct EAN per call). */
  const cashSale = (i: number) => ({ items: [{ ean: EANS[i], quantity: 1 }], payments: [{ method: 'cash', amountMinorUnits: 500 }] });

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRootAsync({
          useFactory: () => ({ type: 'postgres', entities: loadAllEntities() as any, synchronize: true }),
          dataSourceFactory: async () => (dataSource.isInitialized ? dataSource : dataSource.initialize()),
        }),
        CacheModule, MessagingModule, RealtimeModule, TimewinModule, SalesModule, ReturnsModule, PosSessionModule,
      ],
    }).compile();
    ds = moduleRef.get(DataSource);
    sales = moduleRef.get(SalesService);
    sessions = moduleRef.get(PosSessionService);
    scoreEvents = moduleRef.get(getRepositoryToken(EmployeeScoreEventEntity));
  });

  afterAll(async () => { await moduleRef?.close(); });

  it('derives expected = opening float + session cash sales, and the écart', async () => {
    const storeId = await seedStore();
    const empId = uuidv4();
    const terminal = 'TERMINAL 02';
    const session = await sessions.openSession(storeId, empId, SNAP, { terminalId: terminal, openingCashMinorUnits: 10000 });

    // Two cash sales (500 each) rung on that terminal → bound to the session.
    await sales.createSale(storeId, empId, cashSale(0) as any, SNAP, undefined, terminal); // 500
    await sales.createSale(storeId, empId, cashSale(1) as any, SNAP, undefined, terminal); // 500

    // Cashier counts 11 000 — exact (10 000 + 1 000).
    const closed = await sessions.closeSession(session.id, storeId, empId, { countedCashMinorUnits: 11000 });

    expect(closed.cashSalesMinorUnits).toBe(1000);
    expect(closed.expectedCashMinorUnits).toBe(11000);
    expect(closed.countedCashMinorUnits).toBe(11000);
    expect(closed.cashDifferenceMinorUnits).toBe(0);
    expect(closed.cashCountedAt).toBeTruthy();
  });

  it('classifies a material shortage into a CASH_DIFFERENCE_* score event bound to the session', async () => {
    const storeId = await seedStore();
    const empId = uuidv4();
    const terminal = 'TERMINAL 03';
    const session = await sessions.openSession(storeId, empId, SNAP, { terminalId: terminal, openingCashMinorUnits: 10000 });
    await sales.createSale(storeId, empId, cashSale(0) as any, SNAP, undefined, terminal); // 500 → expected 10500

    // Count 9 900 → shortage of 600 centimes (≥ 500 minor threshold).
    const closed = await sessions.closeSession(session.id, storeId, empId, { countedCashMinorUnits: 9900 });
    expect(closed.expectedCashMinorUnits).toBe(10500);
    expect(closed.cashDifferenceMinorUnits).toBe(-600);

    const diff = await scoreEvents.find({ where: { sessionId: session.id } });
    const types = diff.map((e) => e.eventType);
    expect(types).toContain('CASH_COUNT_COMPLETED');
    expect(types).toContain('CASH_DIFFERENCE_MINOR');
    const minor = diff.find((e) => e.eventType === 'CASH_DIFFERENCE_MINOR')!;
    expect(minor.terminalId).toBe(terminal);
    expect(minor.employeeId).toBe(empId);
    expect(minor.category).toBe('cash');
  });

  it('no CASH_DIFFERENCE event for a balanced count (only CASH_COUNT_COMPLETED)', async () => {
    const storeId = await seedStore();
    const empId = uuidv4();
    const terminal = 'TERMINAL 04';
    const session = await sessions.openSession(storeId, empId, SNAP, { terminalId: terminal, openingCashMinorUnits: 0 });
    await sales.createSale(storeId, empId, cashSale(0) as any, SNAP, undefined, terminal); // expected 500
    await sessions.closeSession(session.id, storeId, empId, { countedCashMinorUnits: 500 });

    const evs = await scoreEvents.find({ where: { sessionId: session.id } });
    const types = evs.map((e) => e.eventType);
    expect(types).toContain('CASH_COUNT_COMPLETED');
    expect(types.some((t) => t.startsWith('CASH_DIFFERENCE_'))).toBe(false);
  });

  it('expected reflects cash sales only when the opening float is unknown (null)', async () => {
    const storeId = await seedStore();
    const empId = uuidv4();
    const terminal = 'TERMINAL 05';
    const session = await sessions.openSession(storeId, empId, SNAP, { terminalId: terminal }); // no float
    expect(session.openingCashMinorUnits).toBeNull();
    await sales.createSale(storeId, empId, cashSale(0) as any, SNAP, undefined, terminal); // 500

    const closed = await sessions.closeSession(session.id, storeId, empId, { countedCashMinorUnits: 500 });
    expect(closed.cashSalesMinorUnits).toBe(500);
    expect(closed.expectedCashMinorUnits).toBe(500); // opening treated as 0, tracked as unknown
    expect(closed.cashDifferenceMinorUnits).toBe(0);
  });

  it('a MOTIVATED skip records CASH_COUNT_SKIPPED (reason persisted + scored)', async () => {
    const storeId = await seedStore();
    const empId = uuidv4();
    const terminal = 'TERMINAL 20';
    const session = await sessions.openSession(storeId, empId, SNAP, { terminalId: terminal, openingCashMinorUnits: 5000 });
    await sales.createSale(storeId, empId, cashSale(0) as any, SNAP, undefined, terminal);

    const closed = await sessions.closeSession(session.id, storeId, empId, { skipReason: 'tiroir relevé par le responsable' });
    expect(closed.isActive).toBe(false);
    expect(closed.cashCountSkippedReason).toBe('tiroir relevé par le responsable');
    expect(closed.cashCountSkippedAt).toBeTruthy();
    expect(closed.countedCashMinorUnits).toBeNull(); // pas de comptage
    expect(closed.cashDifferenceMinorUnits).toBeNull();

    const evs = await scoreEvents.find({ where: { sessionId: session.id } });
    const skip = evs.find((e) => e.eventType === 'CASH_COUNT_SKIPPED');
    expect(skip).toBeTruthy();
    expect(skip!.terminalId).toBe(terminal);
    expect(skip!.employeeId).toBe(empId);
    expect(skip!.pointsDelta).toBeLessThan(0); // fait pénalisant (motivé mais tracé)
  });

  it('a SILENT close (no count, no reason) records no cash/skip event (résilience)', async () => {
    const storeId = await seedStore();
    const empId = uuidv4();
    const terminal = 'TERMINAL 21';
    const session = await sessions.openSession(storeId, empId, SNAP, { terminalId: terminal, openingCashMinorUnits: 5000 });
    await sales.createSale(storeId, empId, cashSale(0) as any, SNAP, undefined, terminal);

    const closed = await sessions.closeSession(session.id, storeId, empId);
    expect(closed.cashCountSkippedReason).toBeNull();
    expect(closed.cashCountSkippedAt).toBeNull();

    const evs = await scoreEvents.find({ where: { sessionId: session.id } });
    expect(evs.some((e) => e.eventType === 'CASH_COUNT_SKIPPED')).toBe(false);
    expect(evs.some((e) => e.eventType.startsWith('CASH_DIFFERENCE_'))).toBe(false);
  });

  it('a close WITHOUT a count leaves cash fields null (resilience unchanged)', async () => {
    const storeId = await seedStore();
    const empId = uuidv4();
    const terminal = 'TERMINAL 06';
    const session = await sessions.openSession(storeId, empId, SNAP, { terminalId: terminal, openingCashMinorUnits: 5000 });
    await sales.createSale(storeId, empId, cashSale(0) as any, SNAP, undefined, terminal);

    const closed = await sessions.closeSession(session.id, storeId, empId);
    expect(closed.isActive).toBe(false);
    expect(closed.countedCashMinorUnits).toBeNull();
    expect(closed.expectedCashMinorUnits).toBeNull();
    expect(closed.cashDifferenceMinorUnits).toBeNull();

    const evs = await scoreEvents.find({ where: { sessionId: session.id } });
    expect(evs.some((e) => e.eventType.startsWith('CASH_'))).toBe(false);
  });

  it('listSessions exposes the counted session (manager read) and filters by cash count', async () => {
    const storeId = await seedStore();
    const empId = uuidv4();
    const terminal = 'TERMINAL 08';
    const session = await sessions.openSession(storeId, empId, SNAP, { terminalId: terminal, openingCashMinorUnits: 1000 });
    await sales.createSale(storeId, empId, cashSale(0) as any, SNAP, undefined, terminal);
    await sessions.closeSession(session.id, storeId, empId, { countedCashMinorUnits: 1400 });

    const all = await sessions.listSessions(storeId);
    const row = all.find((s) => s.id === session.id)!;
    expect(row).toBeTruthy();
    expect(row.expectedCashMinorUnits).toBe(1500);
    expect(row.countedCashMinorUnits).toBe(1400);
    expect(row.cashDifferenceMinorUnits).toBe(-100);

    const counted = await sessions.listSessions(storeId, { withCashCountOnly: true });
    expect(counted.every((s) => s.cashCountedAt != null)).toBe(true);
    expect(counted.some((s) => s.id === session.id)).toBe(true);

    // Tenant scoping: another store sees nothing of this one.
    const otherStore = await seedStore();
    const otherList = await sessions.listSessions(otherStore);
    expect(otherList.some((s) => s.id === session.id)).toBe(false);
  });

  it('only counts cash legs — a card sale does not inflate the expected cash', async () => {
    const storeId = await seedStore();
    const empId = uuidv4();
    const terminal = 'TERMINAL 07';
    const session = await sessions.openSession(storeId, empId, SNAP, { terminalId: terminal, openingCashMinorUnits: 0 });
    await sales.createSale(storeId, empId, cashSale(0) as any, SNAP, undefined, terminal); // 500 cash
    await sales.createSale(storeId, empId, { items: [{ ean: EANS[1], quantity: 1 }], payments: [{ method: 'card', amountMinorUnits: 500 }] } as any, SNAP, undefined, terminal);

    const closed = await sessions.closeSession(session.id, storeId, empId, { countedCashMinorUnits: 500 });
    expect(closed.cashSalesMinorUnits).toBe(500); // card leg excluded
    expect(closed.cashDifferenceMinorUnits).toBe(0);
  });
});
