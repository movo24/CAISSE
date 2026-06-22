import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, ForbiddenException } from '@nestjs/common';
import { TimewinController } from './timewin.controller';
import { TimewinService } from './timewin.service';

/**
 * Controller-level tests for the TimeWin24 proxy.
 *
 * The controller is a thin relay: it delegates to TimewinService, sanitizes
 * sensitive employee fields, and maps upstream errors to HttpException. These
 * tests mock the service entirely (no network), and focus on:
 *   - correct delegation (right method, right args)
 *   - PII sanitization (posPin / posQrCode / hashes never leak)
 *   - error mapping (err.status/err.response → HttpException)
 *   - the newly-exposed routes (store-schedule GET/PUT, stores, circuit state)
 */
describe('TimewinController', () => {
  let controller: TimewinController;
  let service: jest.Mocked<TimewinService>;
  // Admin req → resolveStoreId returns the passed storeId (admin may target any store).
  const ADMIN_REQ = { user: { role: 'admin', storeId: 'S1' } } as any;

  beforeEach(async () => {
    const serviceMock: Partial<jest.Mocked<TimewinService>> = {
      isHealthy: jest.fn(),
      getCircuitState: jest.fn(),
      loginEmployee: jest.fn(),
      getEmployeeContext: jest.fn(),
      syncEmployees: jest.fn(),
      getCachedEmployees: jest.fn(),
      getTodayShifts: jest.fn(),
      getStoreConfig: jest.fn(),
      getStoreSchedule: jest.fn(),
      updateStoreSchedule: jest.fn(),
      fetchStores: jest.fn(),
      clockIn: jest.fn(),
      clockOut: jest.fn(),
      pushEvent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TimewinController],
      providers: [{ provide: TimewinService, useValue: serviceMock }],
    }).compile();

    controller = module.get(TimewinController);
    service = module.get(TimewinService);
  });

  // ── health ──────────────────────────────────────────────────────────────
  describe('health', () => {
    it('reports connected + circuit state when healthy', async () => {
      service.isHealthy.mockResolvedValue(true);
      service.getCircuitState.mockReturnValue('CLOSED');
      await expect(controller.health()).resolves.toEqual({
        timewin24: 'connected',
        circuit: 'CLOSED',
      });
    });

    it('reports unreachable when unhealthy', async () => {
      service.isHealthy.mockResolvedValue(false);
      service.getCircuitState.mockReturnValue('OPEN');
      const res = await controller.health();
      expect(res.timewin24).toBe('unreachable');
      expect(res.circuit).toBe('OPEN');
    });
  });

  // ── login ───────────────────────────────────────────────────────────────
  describe('login', () => {
    it('delegates to service.loginEmployee', async () => {
      const payload = { pin: '1234', storeId: 'S1' };
      service.loginEmployee.mockResolvedValue({ employee_id: 'E1' } as any);
      await controller.login(payload);
      expect(service.loginEmployee).toHaveBeenCalledWith(payload);
    });

    it('maps upstream error to HttpException with status + response', async () => {
      const err: any = new Error('bad pin');
      err.status = 401;
      err.response = { error: 'invalid' };
      service.loginEmployee.mockRejectedValue(err);
      await expect(controller.login({ storeId: 'S1' } as any)).rejects.toBeInstanceOf(HttpException);
    });

    it('defaults to 502 when upstream error has no status', async () => {
      service.loginEmployee.mockRejectedValue(new Error('boom'));
      try {
        await controller.login({ storeId: 'S1' } as any);
        throw new Error('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(HttpException);
        expect((e as HttpException).getStatus()).toBe(502);
      }
    });
  });

  // ── employees/sync — PII sanitization ────────────────────────────────────
  describe('syncEmployees', () => {
    it('strips posPin / posQrCode / hashes from returned employees', async () => {
      service.syncEmployees.mockResolvedValue([
        {
          id: 'E1',
          firstName: 'Jean',
          posPin: '1234',
          posQrCode: 'QR',
          posPinHash: 'hash',
          cachedAt: 123,
        } as any,
      ]);
      const res = await controller.syncEmployees('S1', ADMIN_REQ);
      expect(res.count).toBe(1);
      const emp = res.employees[0] as any;
      expect(emp.firstName).toBe('Jean');
      expect(emp.posPin).toBeUndefined();
      expect(emp.posQrCode).toBeUndefined();
      expect(emp.posPinHash).toBeUndefined();
      expect(emp.cachedAt).toBeUndefined();
    });

    it('falls back to cache when sync fails', async () => {
      service.syncEmployees.mockRejectedValue(new Error('down'));
      service.getCachedEmployees.mockReturnValue([
        { id: 'E1', firstName: 'Cache', posPin: 'x' } as any,
      ]);
      const res = await controller.syncEmployees('S1', ADMIN_REQ);
      expect(res.fromCache).toBe(true);
      expect((res.employees[0] as any).posPin).toBeUndefined();
    });

    it('throws when sync fails and no cache exists', async () => {
      service.syncEmployees.mockRejectedValue(Object.assign(new Error('down'), { status: 503 }));
      service.getCachedEmployees.mockReturnValue(null);
      await expect(controller.syncEmployees('S1', ADMIN_REQ)).rejects.toBeInstanceOf(HttpException);
    });
  });

  // ── tenant scoping (M203 follow-up: /timewin/* storeId resolution) ────────
  describe('tenant scoping of storeId-param endpoints', () => {
    const CASHIER_S1 = { user: { role: 'cashier', storeId: 'S1' } } as any;
    it('a non-admin targeting their OWN store passes through', async () => {
      service.getStoreConfig.mockResolvedValue({ ok: true } as any);
      await controller.storeConfig('S1', CASHIER_S1);
      expect(service.getStoreConfig).toHaveBeenCalledWith('S1');
    });
    it('DECISIVE — a non-admin targeting ANOTHER store is refused (403)', async () => {
      await expect(controller.storeConfig('S2', CASHIER_S1)).rejects.toBeInstanceOf(ForbiddenException);
      expect(service.getStoreConfig).not.toHaveBeenCalled();
    });
    it('an admin may target any store', async () => {
      service.getStoreConfig.mockResolvedValue({ ok: true } as any);
      await controller.storeConfig('S2', ADMIN_REQ);
      expect(service.getStoreConfig).toHaveBeenCalledWith('S2');
    });
    it('a non-admin cannot WRITE another store schedule (403)', async () => {
      await expect(controller.updateStoreSchedule('S2', { schedules: [] }, CASHIER_S1)).rejects.toBeInstanceOf(ForbiddenException);
      expect(service.updateStoreSchedule).not.toHaveBeenCalled();
    });
  });

  // ── store-schedule (newly exposed) ───────────────────────────────────────
  describe('store-schedule', () => {
    it('GET delegates to getStoreSchedule with storeId', async () => {
      service.getStoreSchedule.mockResolvedValue({ schedules: [] });
      await controller.getStoreSchedule('S1', ADMIN_REQ);
      expect(service.getStoreSchedule).toHaveBeenCalledWith('S1');
    });

    it('PUT delegates schedules array to updateStoreSchedule', async () => {
      service.updateStoreSchedule.mockResolvedValue({ ok: true });
      const schedules = [{ day: 1, open: '09:00', close: '19:00' }];
      await controller.updateStoreSchedule('S1', { schedules }, ADMIN_REQ);
      expect(service.updateStoreSchedule).toHaveBeenCalledWith('S1', schedules);
    });

    it('PUT tolerates a missing schedules field (defaults to [])', async () => {
      service.updateStoreSchedule.mockResolvedValue({ ok: true });
      await controller.updateStoreSchedule('S1', {} as any, ADMIN_REQ);
      expect(service.updateStoreSchedule).toHaveBeenCalledWith('S1', []);
    });

    it('GET maps upstream error to HttpException', async () => {
      service.getStoreSchedule.mockRejectedValue(Object.assign(new Error('x'), { status: 500 }));
      await expect(controller.getStoreSchedule('S1', ADMIN_REQ)).rejects.toBeInstanceOf(HttpException);
    });
  });

  // ── stores (newly exposed) ───────────────────────────────────────────────
  describe('stores', () => {
    it('returns count + stores from fetchStores', async () => {
      service.fetchStores.mockResolvedValue([{ id: 'S1' }, { id: 'S2' }] as any);
      const res = await controller.stores();
      expect(res.count).toBe(2);
      expect(res.stores).toHaveLength(2);
    });

    it('maps upstream error to HttpException', async () => {
      service.fetchStores.mockRejectedValue(new Error('nope'));
      await expect(controller.stores()).rejects.toBeInstanceOf(HttpException);
    });
  });

  // ── clock in/out ─────────────────────────────────────────────────────────
  describe('clock in/out', () => {
    it('clockIn passes employeeId + storeId', async () => {
      service.clockIn.mockResolvedValue({ status: 'in' } as any);
      await controller.clockIn({ employeeId: 'E1', storeId: 'S1' });
      expect(service.clockIn).toHaveBeenCalledWith('E1', 'S1');
    });

    it('clockOut passes employeeId + storeId', async () => {
      service.clockOut.mockResolvedValue({ status: 'out' } as any);
      await controller.clockOut({ employeeId: 'E1', storeId: 'S1' });
      expect(service.clockOut).toHaveBeenCalledWith('E1', 'S1');
    });
  });

  // ── events — non-blocking ────────────────────────────────────────────────
  describe('pushEvent', () => {
    it('delegates event to service', async () => {
      service.pushEvent.mockResolvedValue({ received: true, eventId: 'X' });
      const res = await controller.pushEvent({ storeId: 'S1', eventType: 'sale.completed' });
      expect(service.pushEvent).toHaveBeenCalledWith('S1', 'sale.completed', undefined, undefined);
      expect(res).toEqual({ received: true, eventId: 'X' });
    });

    it('returns a soft failure instead of throwing when push fails', async () => {
      service.pushEvent.mockRejectedValue(new Error('webhook down'));
      const res = await controller.pushEvent({ storeId: 'S1', eventType: 'sale.completed' });
      expect(res).toEqual({ received: false, error: 'webhook down' });
    });
  });
});
