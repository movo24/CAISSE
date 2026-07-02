/**
 * POS Session primitive — γ-model tests (D1 decision: terminal-bound).
 *
 * Invariant under test: ONE active session per (storeId, terminalId).
 *   - Same employee CAN hold sessions on two different terminals.
 *   - Two employees CANNOT hold concurrent active sessions on the same
 *     terminal.
 *   - Opening without X-Terminal-Id is refused.
 *   - terminal_id is persisted and read back.
 *
 * NOT tested here (out of scope of (1a)):
 *   - createSale/voidSale consulting this service — that is the (1b)
 *     binding (issue #4, operator attribution), still open.
 *   - Manager-authorizer capture (issue #5), kept separate from #4.
 */
import './helpers/env-setup';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';

import { createPgMemDataSource, loadAllEntities } from './helpers/pgmem';
import { PosSessionModule } from '../src/modules/pos-session/pos-session.module';
import { PosSessionService } from '../src/modules/pos-session/pos-session.service';

describe('PosSession primitive — γ (terminal-bound)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let service: PosSessionService;
  const STORE_ID = uuidv4();
  const EMPLOYEE_A = uuidv4();
  const EMPLOYEE_B = uuidv4();
  const TERMINAL_1 = 'caisse-01';
  const TERMINAL_2 = 'caisse-02';
  const SNAP = { employeeName: 'Alice', employeeRole: 'admin', maxDiscount: 100 };

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRootAsync({
          useFactory: () => ({
            type: 'postgres',
            entities: loadAllEntities() as any,
            synchronize: true,
          }),
          dataSourceFactory: async () =>
            dataSource.isInitialized ? dataSource : dataSource.initialize(),
        }),
        PosSessionModule,
      ],
    }).compile();
    ds = moduleRef.get(DataSource);
    service = moduleRef.get(PosSessionService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  // pg-mem isolation: clean pos_sessions between tests so order doesn't leak.
  beforeEach(async () => {
    await ds.query('TRUNCATE pos_sessions');
  });

  describe('openSession — γ invariant', () => {
    it('opens an active session bound to a terminal, terminal_id persisted', async () => {
      const session = await service.openSession(STORE_ID, EMPLOYEE_A, SNAP, {
        terminalId: TERMINAL_1,
      });
      expect(session.id).toBeTruthy();
      expect(session.storeId).toBe(STORE_ID);
      expect(session.employeeId).toBe(EMPLOYEE_A);
      expect(session.terminalId).toBe(TERMINAL_1);
      expect(session.isActive).toBe(true);
      expect(session.closedAt).toBeNull();

      // terminal_id is re-read from the DB, not just echoed from input.
      const reloaded = await ds.query(
        `SELECT terminal_id FROM pos_sessions WHERE id = $1`,
        [session.id],
      );
      expect(reloaded[0].terminal_id).toBe(TERMINAL_1);
    });

    it('refuses to open without X-Terminal-Id', async () => {
      await expect(
        service.openSession(STORE_ID, EMPLOYEE_A, SNAP, {}),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.openSession(STORE_ID, EMPLOYEE_A, SNAP, { terminalId: '' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('same employee CAN open sessions on two different terminals', async () => {
      const s1 = await service.openSession(STORE_ID, EMPLOYEE_A, SNAP, {
        terminalId: TERMINAL_1,
      });
      const s2 = await service.openSession(STORE_ID, EMPLOYEE_A, SNAP, {
        terminalId: TERMINAL_2,
      });
      expect(s1.isActive).toBe(true);
      expect(s2.isActive).toBe(true);
      expect(s1.terminalId).toBe(TERMINAL_1);
      expect(s2.terminalId).toBe(TERMINAL_2);
    });

    it('two employees CANNOT hold concurrent active sessions on the same terminal', async () => {
      await service.openSession(STORE_ID, EMPLOYEE_A, SNAP, {
        terminalId: TERMINAL_1,
      });
      await expect(
        service.openSession(STORE_ID, EMPLOYEE_B, SNAP, {
          terminalId: TERMINAL_1,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('same employee reopening the SAME terminal while active is refused', async () => {
      await service.openSession(STORE_ID, EMPLOYEE_A, SNAP, {
        terminalId: TERMINAL_1,
      });
      await expect(
        service.openSession(STORE_ID, EMPLOYEE_A, SNAP, {
          terminalId: TERMINAL_1,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('allows a new session on a terminal after the previous one is closed (relève)', async () => {
      const first = await service.openSession(STORE_ID, EMPLOYEE_A, SNAP, {
        terminalId: TERMINAL_1,
      });
      await service.closeSession(first.id, STORE_ID, EMPLOYEE_A);
      // Different employee takes over the same register.
      const second = await service.openSession(STORE_ID, EMPLOYEE_B, SNAP, {
        terminalId: TERMINAL_1,
      });
      expect(second.id).not.toBe(first.id);
      expect(second.employeeId).toBe(EMPLOYEE_B);
      expect(second.terminalId).toBe(TERMINAL_1);
    });

    it('snapshots employee name/role/maxDiscount', async () => {
      const session = await service.openSession(
        STORE_ID,
        EMPLOYEE_A,
        { employeeName: 'Marie', employeeRole: 'cashier', maxDiscount: 15 },
        { terminalId: TERMINAL_1 },
      );
      expect(session.employeeName).toBe('Marie');
      expect(session.employeeRole).toBe('cashier');
      expect(Number(session.maxDiscount)).toBe(15);
    });

    it('persists offlineMode flag', async () => {
      const session = await service.openSession(STORE_ID, EMPLOYEE_A, SNAP, {
        terminalId: TERMINAL_1,
        offlineMode: true,
      });
      expect(session.offlineMode).toBe(true);
    });

    it('refuses without a storeId or employeeId (defensive)', async () => {
      await expect(
        service.openSession('', EMPLOYEE_A, SNAP, { terminalId: TERMINAL_1 }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.openSession(STORE_ID, '', SNAP, { terminalId: TERMINAL_1 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('closeSession', () => {
    it('closes an active session and sets closedAt', async () => {
      const opened = await service.openSession(STORE_ID, EMPLOYEE_A, SNAP, {
        terminalId: TERMINAL_1,
      });
      const closed = await service.closeSession(opened.id, STORE_ID, EMPLOYEE_A);
      expect(closed.isActive).toBe(false);
      expect(closed.closedAt).not.toBeNull();
    });

    it('refuses to close a non-existent session', async () => {
      await expect(
        service.closeSession(uuidv4(), STORE_ID, EMPLOYEE_A),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses to close an already-closed session', async () => {
      const opened = await service.openSession(STORE_ID, EMPLOYEE_A, SNAP, {
        terminalId: TERMINAL_1,
      });
      await service.closeSession(opened.id, STORE_ID, EMPLOYEE_A);
      await expect(
        service.closeSession(opened.id, STORE_ID, EMPLOYEE_A),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses to close a session belonging to a different employee', async () => {
      const opened = await service.openSession(STORE_ID, EMPLOYEE_A, SNAP, {
        terminalId: TERMINAL_1,
      });
      await expect(
        service.closeSession(opened.id, STORE_ID, EMPLOYEE_B),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses to close a session belonging to a different store', async () => {
      const opened = await service.openSession(STORE_ID, EMPLOYEE_A, SNAP, {
        terminalId: TERMINAL_1,
      });
      await expect(
        service.closeSession(opened.id, uuidv4(), EMPLOYEE_A),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findActiveForTerminal', () => {
    it('returns the active session for the terminal', async () => {
      const opened = await service.openSession(STORE_ID, EMPLOYEE_A, SNAP, {
        terminalId: TERMINAL_1,
      });
      const found = await service.findActiveForTerminal(STORE_ID, TERMINAL_1);
      expect(found?.id).toBe(opened.id);
      expect(found?.employeeId).toBe(EMPLOYEE_A);
    });

    it('returns null when the terminal has no active session', async () => {
      const found = await service.findActiveForTerminal(STORE_ID, TERMINAL_1);
      expect(found).toBeNull();
    });

    it('returns null after the terminal session is closed', async () => {
      const opened = await service.openSession(STORE_ID, EMPLOYEE_A, SNAP, {
        terminalId: TERMINAL_1,
      });
      await service.closeSession(opened.id, STORE_ID, EMPLOYEE_A);
      const found = await service.findActiveForTerminal(STORE_ID, TERMINAL_1);
      expect(found).toBeNull();
    });

    it('disambiguates per terminal: two terminals, two sessions, each lookup returns its own', async () => {
      const s1 = await service.openSession(STORE_ID, EMPLOYEE_A, SNAP, {
        terminalId: TERMINAL_1,
      });
      const s2 = await service.openSession(STORE_ID, EMPLOYEE_B, SNAP, {
        terminalId: TERMINAL_2,
      });
      const f1 = await service.findActiveForTerminal(STORE_ID, TERMINAL_1);
      const f2 = await service.findActiveForTerminal(STORE_ID, TERMINAL_2);
      expect(f1?.id).toBe(s1.id);
      expect(f2?.id).toBe(s2.id);
    });

    it('refuses lookup without a terminalId', async () => {
      await expect(
        service.findActiveForTerminal(STORE_ID, ''),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── P351 — fond de caisse + comptage persisté (POS-016/017/017b) ──────────

  describe('P351 — opening float & till count', () => {
    it('persiste le fond de caisse à l’ouverture ; absent = NULL ; refuse float/négatif', async () => {
      const withFloat = await service.openSession(STORE_ID, EMPLOYEE_A, SNAP, {
        terminalId: TERMINAL_1, openingFloatMinorUnits: 10000, // 100,00 €
      });
      expect(withFloat.openingFloatMinorUnits).toBe(10000);

      const without = await service.openSession(STORE_ID, EMPLOYEE_B, SNAP, {
        terminalId: TERMINAL_2,
      });
      expect(without.openingFloatMinorUnits).toBeNull();

      await expect(
        service.openSession(STORE_ID, EMPLOYEE_A, SNAP, { terminalId: 'caisse-03', openingFloatMinorUnits: 99.5 }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.openSession(STORE_ID, EMPLOYEE_A, SNAP, { terminalId: 'caisse-03', openingFloatMinorUnits: -1 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('clôture avec comptage : écart signé calculé SERVEUR (compté − fond − espèces session) et FIGÉ', async () => {
      const s = await service.openSession(STORE_ID, EMPLOYEE_A, SNAP, {
        terminalId: TERMINAL_1, openingFloatMinorUnits: 10000,
      });
      // aucune vente stampée → attendu = 10000 ; compté 9 950 → écart -50
      const closed = await service.closeSession(s.id, STORE_ID, EMPLOYEE_A, {
        countedCashMinorUnits: 9950,
      });
      expect(closed.countedCashMinorUnits).toBe(9950);
      expect(closed.cashVarianceMinorUnits).toBe(-50);
      expect(closed.isActive).toBe(false);

      // figé : la ligne en base porte l'écart, session close
      const [row] = await ds.query(
        `SELECT counted_cash_minor_units, cash_variance_minor_units FROM pos_sessions WHERE id = $1`, [s.id],
      );
      expect(Number(row.cash_variance_minor_units)).toBe(-50);
    });

    it('clôture SANS comptage : champs NULL (comportement existant intact) ; comptage invalide refusé', async () => {
      const s = await service.openSession(STORE_ID, EMPLOYEE_A, SNAP, { terminalId: TERMINAL_1 });
      await expect(
        service.closeSession(s.id, STORE_ID, EMPLOYEE_A, { countedCashMinorUnits: -5 }),
      ).rejects.toThrow(BadRequestException);
      const closed = await service.closeSession(s.id, STORE_ID, EMPLOYEE_A);
      expect(closed.countedCashMinorUnits).toBeNull();
      expect(closed.cashVarianceMinorUnits).toBeNull();
    });

    it('sans fond de caisse déclaré, l’attendu = espèces session seules (fond traité comme 0)', async () => {
      const s = await service.openSession(STORE_ID, EMPLOYEE_A, SNAP, { terminalId: TERMINAL_1 });
      const closed = await service.closeSession(s.id, STORE_ID, EMPLOYEE_A, {
        countedCashMinorUnits: 200,
      });
      expect(closed.cashVarianceMinorUnits).toBe(200); // 200 − (0 + 0)
    });
  });
});
