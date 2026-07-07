import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { AuthService } from './auth.service';
import { StoreEntity } from '../../database/entities/store.entity';
import { EmployeeEntity } from '../../database/entities/employee.entity';
import { TimewinService } from '../timewin/timewin.service';
import { CACHE_STORE } from '../../common/cache/cache.module';
import { AuditService } from '../audit/audit.service';

/**
 * Authority tests: POS Caisse is the PRIMARY authority for codes/PINs.
 * - Local DB is checked FIRST.
 * - TimeWin24 is only consulted when the local account is NOT FOUND
 *   (and only while the secondary fallback is enabled).
 * - A WRONG PIN on an existing local account is a hard failure that must
 *   NEVER be rescued by a TimeWin24 lookup.
 */
describe('AuthService — code authority (POS Caisse primary)', () => {
  let service: AuthService;
  let employeeRepo: any;
  let storeRepo: any;
  let timewin: { loginEmployee: jest.Mock };
  let audit: { log: jest.Mock };

  const ADMIN_STORE = '_admin';

  const makeEmployee = async (pin: string, over: Partial<EmployeeEntity> = {}): Promise<EmployeeEntity> =>
    ({
      id: 'emp-1',
      storeId: 'store-1',
      firstName: 'Admin',
      lastName: 'Test',
      email: 'admin@caisse.dev',
      pinHash: await bcrypt.hash(pin, 4),
      qrCode: 'QR1',
      role: 'admin',
      maxDiscountPercent: 100,
      isActive: true,
      createdAt: new Date(),
      ...over,
    }) as EmployeeEntity;

  beforeEach(async () => {
    delete process.env.POS_AUTH_AUTHORITY;
    delete process.env.POS_AUTH_TIMEWIN_FALLBACK;

    employeeRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      // pinHash is select:false → the service loads employees via QueryBuilder.addSelect.
      // getMany delegates to find() so existing find.mockResolvedValue(...) drives both paths.
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        getMany: jest.fn(() => employeeRepo.find()),
      })),
    };
    // validateEmployee() re-checks the employee exists + isActive in the DB.
    employeeRepo.findOne.mockResolvedValue({ id: 'emp-1', isActive: true });
    storeRepo = { findOne: jest.fn().mockResolvedValue(null) };
    timewin = { loginEmployee: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(StoreEntity), useValue: storeRepo },
        { provide: getRepositoryToken(EmployeeEntity), useValue: employeeRepo },
        { provide: JwtService, useValue: { sign: () => 'jwt.token' } },
        { provide: TimewinService, useValue: timewin },
        {
          provide: CACHE_STORE,
          useValue: { set: jest.fn(), srem: jest.fn(), sadd: jest.fn(), del: jest.fn(), get: jest.fn(), sismember: jest.fn() },
        },
        { provide: AuditService, useValue: (audit = { log: jest.fn().mockResolvedValue(undefined) }) },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  it('authenticates an admin against the LOCAL DB first (no TimeWin call)', async () => {
    employeeRepo.find.mockResolvedValue([await makeEmployee('1234')]);

    const res = await service.loginByEmail('admin@caisse.dev', '1234');

    expect(res.employee.id).toBe('emp-1');
    expect(res.accessToken).toBeTruthy();
    expect(timewin.loginEmployee).not.toHaveBeenCalled(); // CAISSE is authority
  });

  it('audits a successful admin login WITHOUT logging the PIN', async () => {
    employeeRepo.find.mockResolvedValue([await makeEmployee('1234')]);

    await service.loginByEmail('admin@caisse.dev', '1234');

    expect(audit.log).toHaveBeenCalledTimes(1);
    const entry = audit.log.mock.calls[0][0];
    expect(entry.action).toBe('admin_login');
    expect(entry.entityType).toBe('auth');
    expect(entry.employeeId).toBe('emp-1');
    expect(JSON.stringify(entry)).not.toContain('1234'); // PIN never logged
  });

  it('audits a FAILED admin login (wrong PIN) WITHOUT logging the PIN', async () => {
    employeeRepo.find.mockResolvedValue([await makeEmployee('1234')]);

    await expect(service.loginByEmail('admin@caisse.dev', '0000')).rejects.toThrow();

    expect(audit.log).toHaveBeenCalledTimes(1);
    const entry = audit.log.mock.calls[0][0];
    expect(entry.action).toBe('admin_login_failed');
    expect(entry.storeId).toBe('_admin'); // global chain, readable via ?storeId=_admin
    expect(entry.entityType).toBe('auth');
    expect(entry.details.email).toBe('admin@caisse.dev');
    expect(JSON.stringify(entry)).not.toContain('0000'); // attempted PIN never logged
  });

  it('does NOT let an audit failure mask the auth error', async () => {
    employeeRepo.find.mockResolvedValue([await makeEmployee('1234')]);
    audit.log.mockRejectedValueOnce(new Error('audit down'));
    // The original UnauthorizedException must still surface to the client.
    await expect(service.loginByEmail('admin@caisse.dev', '0000')).rejects.toThrow();
  });

  it('rejects a WRONG PIN on an existing local account WITHOUT trying TimeWin24', async () => {
    employeeRepo.find.mockResolvedValue([await makeEmployee('1234')]);

    await expect(service.loginByEmail('admin@caisse.dev', '0000')).rejects.toThrow(UnauthorizedException);
    expect(timewin.loginEmployee).not.toHaveBeenCalled(); // wrong PIN is a hard failure
  });

  it('falls back to TimeWin24 only when the local account is NOT FOUND', async () => {
    employeeRepo.find.mockResolvedValue([]); // unknown locally
    timewin.loginEmployee.mockResolvedValue({
      employee_id: 'tw-1',
      store_id: 'store-9',
      role: 'manager',
      full_name: 'Tw User',
      max_discount: 20,
    });

    const res = await service.loginByEmail('only-in-timewin@x.com', '1234');

    expect(timewin.loginEmployee).toHaveBeenCalledTimes(1);
    expect(res.employee.id).toBe('tw-1');
  });

  it('does NOT consult TimeWin24 when the secondary fallback is disabled', async () => {
    process.env.POS_AUTH_TIMEWIN_FALLBACK = 'false';
    employeeRepo.find.mockResolvedValue([]); // unknown locally

    await expect(service.loginByEmail('ghost@x.com', '1234')).rejects.toThrow(UnauthorizedException);
    expect(timewin.loginEmployee).not.toHaveBeenCalled(); // CAISSE is sole authority
  });

  it('legacy mode (POS_AUTH_AUTHORITY=timewin) calls TimeWin24 first', async () => {
    process.env.POS_AUTH_AUTHORITY = 'timewin';
    timewin.loginEmployee.mockResolvedValue({
      employee_id: 'tw-1',
      store_id: 'store-1',
      role: 'admin',
      full_name: 'Tw Admin',
      max_discount: 100,
    });

    const res = await service.loginByEmail('admin@caisse.dev', '1234');

    expect(timewin.loginEmployee).toHaveBeenCalledTimes(1);
    expect(res.employee.id).toBe('tw-1');
    expect(employeeRepo.find).not.toHaveBeenCalled(); // local not consulted first
  });
});

/**
 * Brute-force lockout: after too many FAILED attempts from one IP, that IP is
 * locked out (HTTP 429) even with correct credentials, until the cooldown.
 * A different IP is unaffected, and a success resets the counter.
 */
describe('AuthService — per-IP login lockout', () => {
  let service: AuthService;
  let employeeRepo: any;

  // Minimal in-memory cache honouring get/set/del/incr (TTL ignored in tests).
  const makeCache = () => {
    const store = new Map<string, any>();
    return {
      get: jest.fn(async (k: string) => (store.has(k) ? store.get(k) : null)),
      set: jest.fn(async (k: string, v: any) => { store.set(k, v); }),
      del: jest.fn(async (k: string) => { store.delete(k); }),
      incr: jest.fn(async (k: string) => { const n = (store.get(k) || 0) + 1; store.set(k, n); return n; }),
      srem: jest.fn(), sadd: jest.fn(), sismember: jest.fn().mockResolvedValue(false),
    };
  };

  const makeEmployee = async (pin: string): Promise<EmployeeEntity> =>
    ({
      id: 'emp-1', storeId: 'store-1', firstName: 'A', lastName: 'B', email: 'a@b.dev',
      pinHash: await bcrypt.hash(pin, 4), qrCode: 'QR', role: 'cashier',
      maxDiscountPercent: 0, isActive: true, createdAt: new Date(),
    }) as EmployeeEntity;

  const build = async (cache: any) => {
    employeeRepo = {
      find: jest.fn().mockResolvedValue([await makeEmployee('1234')]),
      findOne: jest.fn().mockResolvedValue({ id: 'emp-1', isActive: true }),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        getMany: jest.fn(() => employeeRepo.find()),
      })),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        // storeCode 'store-1' resolves to a store id, and the session build looks it up.
        { provide: getRepositoryToken(StoreEntity), useValue: { findOne: jest.fn().mockResolvedValue({ id: 'store-1', storeCode: 'STORE-1' }) } },
        { provide: getRepositoryToken(EmployeeEntity), useValue: employeeRepo },
        { provide: JwtService, useValue: { sign: () => 'jwt.token' } },
        { provide: TimewinService, useValue: { loginEmployee: jest.fn() } },
        { provide: CACHE_STORE, useValue: cache },
        { provide: AuditService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    service = module.get(AuthService);
  };

  beforeEach(() => {
    delete process.env.POS_AUTH_AUTHORITY;
    process.env.LOGIN_FAIL_MAX = '3'; // small threshold for the test
  });
  afterEach(() => { delete process.env.LOGIN_FAIL_MAX; });

  it('locks an IP out (429) after LOGIN_FAIL_MAX wrong PINs — then blocks even a correct PIN', async () => {
    const cache = makeCache();
    await build(cache);
    const IP = '203.0.113.7';

    // 3 wrong attempts from the same IP
    for (let i = 0; i < 3; i++) {
      await expect(service.loginByPin('store-1', '9999', IP)).rejects.toThrow(UnauthorizedException);
    }
    // 4th attempt — even with the CORRECT PIN — is rejected with 429
    await expect(service.loginByPin('store-1', '1234', IP)).rejects.toMatchObject({
      status: 429,
    });
  });

  it('does NOT lock a different IP, and a success clears the counter', async () => {
    const cache = makeCache();
    await build(cache);

    await expect(service.loginByPin('store-1', '9999', '203.0.113.1')).rejects.toThrow();
    await expect(service.loginByPin('store-1', '9999', '203.0.113.1')).rejects.toThrow();
    // A different IP is unaffected and logs in fine
    const ok = await service.loginByPin('store-1', '1234', '198.51.100.2');
    expect(ok.accessToken).toBeTruthy();
    // The first IP's successful login clears its 2 prior failures
    const ok2 = await service.loginByPin('store-1', '1234', '203.0.113.1');
    expect(ok2.accessToken).toBeTruthy();
    await expect(service.loginByPin('store-1', '9999', '203.0.113.1')).rejects.toThrow(UnauthorizedException); // counter reset → not locked
  });
});
