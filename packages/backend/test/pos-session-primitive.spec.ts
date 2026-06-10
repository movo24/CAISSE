/**
 * POS Session primitive — (1a) tests.
 *
 * Covers the lifecycle:
 *   - openSession refuses if an active session already exists for (store, employee).
 *   - closeSession refuses if the session doesn't exist or is already closed.
 *   - closeSession refuses if the caller is not the owning employee or store.
 *   - findActive returns the right session, or null when none.
 *
 * NOT tested here (out of scope of (1a)):
 *   - createSale/voidSale consulting this service. (1b) wires the binding.
 *   - Multi-terminal disambiguation (deferred to (1b)/strate II).
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

describe('PosSession primitive — (1a)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let service: PosSessionService;
  const STORE_ID = uuidv4();
  const EMPLOYEE_A = uuidv4();
  const EMPLOYEE_B = uuidv4();
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

  describe('openSession', () => {
    it('opens an active session for (store, employee)', async () => {
      const session = await service.openSession(STORE_ID, EMPLOYEE_A, SNAP);
      expect(session.id).toBeTruthy();
      expect(session.storeId).toBe(STORE_ID);
      expect(session.employeeId).toBe(EMPLOYEE_A);
      expect(session.isActive).toBe(true);
      expect(session.closedAt).toBeNull();
      expect(session.offlineMode).toBe(false);
    });

    it('snapshots employee name/role/maxDiscount', async () => {
      const session = await service.openSession(STORE_ID, EMPLOYEE_A, {
        employeeName: 'Marie',
        employeeRole: 'cashier',
        maxDiscount: 15,
      });
      expect(session.employeeName).toBe('Marie');
      expect(session.employeeRole).toBe('cashier');
      expect(Number(session.maxDiscount)).toBe(15);
    });

    it('refuses if an active session already exists for (store, employee)', async () => {
      await service.openSession(STORE_ID, EMPLOYEE_A, SNAP);
      await expect(
        service.openSession(STORE_ID, EMPLOYEE_A, SNAP),
      ).rejects.toThrow(ConflictException);
    });

    it('allows a second session if the first is closed', async () => {
      const first = await service.openSession(STORE_ID, EMPLOYEE_A, SNAP);
      await service.closeSession(first.id, STORE_ID, EMPLOYEE_A);
      const second = await service.openSession(STORE_ID, EMPLOYEE_A, SNAP);
      expect(second.id).toBeTruthy();
      expect(second.id).not.toBe(first.id);
    });

    it('allows different employees to have parallel active sessions in the same store', async () => {
      const a = await service.openSession(STORE_ID, EMPLOYEE_A, SNAP);
      const b = await service.openSession(STORE_ID, EMPLOYEE_B, SNAP);
      expect(a.id).not.toBe(b.id);
      expect(a.isActive).toBe(true);
      expect(b.isActive).toBe(true);
    });

    it('persists offlineMode flag', async () => {
      const session = await service.openSession(STORE_ID, EMPLOYEE_A, SNAP, {
        offlineMode: true,
      });
      expect(session.offlineMode).toBe(true);
    });

    it('accepts terminalId in the DTO but does not persist at (1a)', async () => {
      // terminal_id is a strate II addition (additive migration deferred).
      // At (1a) the DTO accepts it for forward-compat but does not store.
      const terminalId = uuidv4();
      const session = await service.openSession(STORE_ID, EMPLOYEE_A, SNAP, {
        terminalId,
      });
      // Open succeeds, permissions stays empty (no field for terminalId).
      expect(session.id).toBeTruthy();
      expect(session.permissions).toEqual({});
    });

    it('refuses without a storeId or employeeId (defensive)', async () => {
      await expect(
        service.openSession('', EMPLOYEE_A, SNAP),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.openSession(STORE_ID, '', SNAP),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('closeSession', () => {
    it('closes an active session and sets closedAt', async () => {
      const opened = await service.openSession(STORE_ID, EMPLOYEE_A, SNAP);
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
      const opened = await service.openSession(STORE_ID, EMPLOYEE_A, SNAP);
      await service.closeSession(opened.id, STORE_ID, EMPLOYEE_A);
      await expect(
        service.closeSession(opened.id, STORE_ID, EMPLOYEE_A),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses to close a session belonging to a different employee', async () => {
      const opened = await service.openSession(STORE_ID, EMPLOYEE_A, SNAP);
      await expect(
        service.closeSession(opened.id, STORE_ID, EMPLOYEE_B),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses to close a session belonging to a different store', async () => {
      const opened = await service.openSession(STORE_ID, EMPLOYEE_A, SNAP);
      await expect(
        service.closeSession(opened.id, uuidv4(), EMPLOYEE_A),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findActive', () => {
    it('returns the active session for (store, employee)', async () => {
      const opened = await service.openSession(STORE_ID, EMPLOYEE_A, SNAP);
      const found = await service.findActive(STORE_ID, EMPLOYEE_A);
      expect(found?.id).toBe(opened.id);
    });

    it('returns null when no active session exists', async () => {
      const found = await service.findActive(STORE_ID, EMPLOYEE_A);
      expect(found).toBeNull();
    });

    it('returns null after the session is closed', async () => {
      const opened = await service.openSession(STORE_ID, EMPLOYEE_A, SNAP);
      await service.closeSession(opened.id, STORE_ID, EMPLOYEE_A);
      const found = await service.findActive(STORE_ID, EMPLOYEE_A);
      expect(found).toBeNull();
    });
  });
});
