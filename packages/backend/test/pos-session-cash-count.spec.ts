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
import { EmployeeScoreService } from '../src/modules/employee-score/employee-score.service';
import { ReturnsService } from '../src/modules/returns/returns.service';
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
  let score: EmployeeScoreService;
  let returns: ReturnsService;
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
    score = moduleRef.get(EmployeeScoreService);
    returns = moduleRef.get(ReturnsService);
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

  it('deducts a session-bound CASH refund from the expected cash (attendu = fond + ventes − remb.)', async () => {
    const storeId = await seedStore();
    const empId = uuidv4();
    const terminal = 'TERMINAL 30';
    const session = await sessions.openSession(storeId, empId, SNAP, { terminalId: terminal, openingCashMinorUnits: 10000 });

    // Vente espèces 500, puis remboursement espèces 500 sur cette même session.
    const sale: any = await sales.createSale(storeId, empId, cashSale(0) as any, SNAP, undefined, terminal);
    const cn = await returns.createReturn(
      storeId,
      empId,
      { originalSaleId: sale.id, items: [{ lineItemId: sale.lineItems[0].id, quantity: 1 }], reason: 'article défectueux', refundMethod: 'cash' },
      'Alice',
      undefined,
      terminal,
    );
    expect(cn.sessionId).toBe(session.id); // rattachement serveur
    expect(cn.terminalId).toBe(terminal);

    // Tiroir réel : 10 000 + 500 − 500 = 10 000 → écart 0 (le remboursement est déduit).
    const closed = await sessions.closeSession(session.id, storeId, empId, { countedCashMinorUnits: 10000 });
    expect(closed.cashSalesMinorUnits).toBe(500);
    expect(closed.cashRefundsMinorUnits).toBe(500);
    expect(closed.expectedCashMinorUnits).toBe(10000);
    expect(closed.cashDifferenceMinorUnits).toBe(0);

    // Fait de score AUTORITATIF : REFUND_CREATED rattaché à la session vérifiée.
    const evs = await scoreEvents.find({ where: { sessionId: session.id } });
    const refund = evs.find((e) => e.eventType === 'REFUND_CREATED');
    expect(refund).toBeTruthy();
    expect(refund!.source).toBe('returns');
    expect(refund!.terminalId).toBe(terminal);
  });

  it('a return WITHOUT a resolvable session stays unbound: no deduction, no score event (fait, pas approximation)', async () => {
    const storeId = await seedStore();
    const empId = uuidv4();
    const terminal = 'TERMINAL 31';
    const session = await sessions.openSession(storeId, empId, SNAP, { terminalId: terminal, openingCashMinorUnits: 0 });
    const sale: any = await sales.createSale(storeId, empId, cashSale(0) as any, SNAP, undefined, terminal);

    // Retour SANS terminal (ex: replay offline) → binding null.
    const cn = await returns.createReturn(
      storeId,
      empId,
      { originalSaleId: sale.id, items: [{ lineItemId: sale.lineItems[0].id, quantity: 1 }], reason: 'retour offline', refundMethod: 'cash' },
      'Alice',
    );
    expect(cn.sessionId).toBeNull();
    expect(cn.terminalId).toBeNull();

    // Non rattaché → non déduit : l'écart montre le fait (500 sortis du tiroir).
    const closed = await sessions.closeSession(session.id, storeId, empId, { countedCashMinorUnits: 0 });
    expect(closed.cashRefundsMinorUnits).toBe(0);
    expect(closed.expectedCashMinorUnits).toBe(500);
    expect(closed.cashDifferenceMinorUnits).toBe(-500);

    const evs = await scoreEvents.find({ where: { sessionId: session.id } });
    expect(evs.some((e) => e.eventType === 'REFUND_CREATED')).toBe(false);
  });

  it('a card refund bound to the session does NOT reduce the expected cash (drawer untouched)', async () => {
    const storeId = await seedStore();
    const empId = uuidv4();
    const terminal = 'TERMINAL 32';
    const session = await sessions.openSession(storeId, empId, SNAP, { terminalId: terminal, openingCashMinorUnits: 0 });
    const sale: any = await sales.createSale(storeId, empId, cashSale(0) as any, SNAP, undefined, terminal); // 500 cash in

    const cn = await returns.createReturn(
      storeId,
      empId,
      { originalSaleId: sale.id, items: [{ lineItemId: sale.lineItems[0].id, quantity: 1 }], reason: 'remboursé sur carte', refundMethod: 'card' },
      'Alice',
      undefined,
      terminal,
    );
    expect(cn.sessionId).toBe(session.id);

    const closed = await sessions.closeSession(session.id, storeId, empId, { countedCashMinorUnits: 500 });
    expect(closed.cashRefundsMinorUnits).toBe(0); // carte ≠ tiroir
    expect(closed.expectedCashMinorUnits).toBe(500);
    expect(closed.cashDifferenceMinorUnits).toBe(0);
  });

  it('opening cash: cashier declares once → reflected in expected at close', async () => {
    const storeId = await seedStore();
    const empId = uuidv4();
    const terminal = 'TERMINAL 40';
    // Open WITHOUT float (as the POS auto-open does), then declare it.
    const session = await sessions.openSession(storeId, empId, SNAP, { terminalId: terminal });
    expect(session.openingCashMinorUnits).toBeNull();

    const declared = await sessions.setOpeningCash(session.id, storeId, empId, 'cashier', 15000);
    expect(declared.openingCashMinorUnits).toBe(15000);
    expect(declared.openingCashSetAt).toBeTruthy();

    await sales.createSale(storeId, empId, cashSale(0) as any, SNAP, undefined, terminal); // +500
    const closed = await sessions.closeSession(session.id, storeId, empId, { countedCashMinorUnits: 15500 });
    expect(closed.expectedCashMinorUnits).toBe(15500); // 15000 fond + 500 ventes
    expect(closed.cashDifferenceMinorUnits).toBe(0);
  });

  it('opening cash: a cashier CANNOT re-declare once set (403), a manager can correct (audited)', async () => {
    const storeId = await seedStore();
    const empId = uuidv4();
    const terminal = 'TERMINAL 41';
    const session = await sessions.openSession(storeId, empId, SNAP, { terminalId: terminal });
    await sessions.setOpeningCash(session.id, storeId, empId, 'cashier', 10000);

    // Cashier re-declaration → forbidden.
    await expect(
      sessions.setOpeningCash(session.id, storeId, empId, 'cashier', 12000),
    ).rejects.toThrow(/manager\/admin/i);

    // Manager correction → allowed + tracked.
    const corrected = await sessions.setOpeningCash(session.id, storeId, uuidv4(), 'manager', 12000);
    expect(corrected.openingCashMinorUnits).toBe(12000);
    expect(corrected.openingCashCorrectedBy).toBeTruthy();
    expect(corrected.openingCashCorrectedAt).toBeTruthy();
  });

  it('opening cash: refused on a closed session', async () => {
    const storeId = await seedStore();
    const empId = uuidv4();
    const terminal = 'TERMINAL 42';
    const session = await sessions.openSession(storeId, empId, SNAP, { terminalId: terminal });
    await sessions.closeSession(session.id, storeId, empId);
    await expect(
      sessions.setOpeningCash(session.id, storeId, empId, 'cashier', 10000),
    ).rejects.toThrow(/closed|frozen/i);
  });

  it('getTeamScores aggregates the store team (worst day-score first, tenant-scoped)', async () => {
    const storeId = await seedStore();
    const empA = uuidv4();
    const empB = uuidv4();

    // empA: a critical cash difference (bigger penalty). empB: a minor one.
    const sA = await sessions.openSession(storeId, empA, { ...SNAP, employeeName: 'Alice A.' }, { terminalId: 'T-A', openingCashMinorUnits: 0 });
    await sales.createSale(storeId, empA, cashSale(0) as any, SNAP, undefined, 'T-A'); // expected 500
    await sessions.closeSession(sA.id, storeId, empA, { countedCashMinorUnits: 6000 }); // +5500 → critical

    const sB = await sessions.openSession(storeId, empB, { ...SNAP, employeeName: 'Bob B.' }, { terminalId: 'T-B', openingCashMinorUnits: 0 });
    await sales.createSale(storeId, empB, cashSale(1) as any, SNAP, undefined, 'T-B'); // expected 500
    await sessions.closeSession(sB.id, storeId, empB, { countedCashMinorUnits: 1200 }); // +700 → minor

    const team = await score.getTeamScores(storeId);
    const ids = team.map((t) => t.employeeId);
    expect(ids).toContain(empA);
    expect(ids).toContain(empB);

    const a = team.find((t) => t.employeeId === empA)!;
    const b = team.find((t) => t.employeeId === empB)!;
    expect(a.employeeName).toBe('Alice A.');
    expect(a.day.total).toBeLessThan(100);
    expect(b.day.total).toBeLessThan(100);
    expect(a.day.total).toBeLessThan(b.day.total); // critical penalises more than minor
    // Sorted worst-first → empA before empB.
    expect(ids.indexOf(empA)).toBeLessThan(ids.indexOf(empB));

    // Tenant scoping: a different store's team does not include these employees.
    const otherStore = await seedStore();
    const otherTeam = await score.getTeamScores(otherStore);
    expect(otherTeam.some((t) => t.employeeId === empA || t.employeeId === empB)).toBe(false);
  });
});
