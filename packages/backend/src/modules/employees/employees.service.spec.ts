import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { EmployeesService } from './employees.service';
import { EmployeeEntity } from '../../database/entities/employee.entity';
import { AuditService } from '../audit/audit.service';

/**
 * C+D: PIN management — per-store uniqueness + format validation.
 *
 * PINs are bcrypt-hashed, so duplicate detection compares the candidate PIN
 * against each active store employee's hash. Uniqueness is scoped per store.
 */
describe('EmployeesService — PIN uniqueness & validation', () => {
  let service: EmployeesService;
  let repo: any;
  let audit: { log: jest.Mock };

  const emp = async (id: string, storeId: string, pin: string): Promise<EmployeeEntity> =>
    ({
      id,
      storeId,
      firstName: 'X',
      lastName: 'Y',
      email: `${id}@x.com`,
      pinHash: await bcrypt.hash(pin, 4),
      qrCode: `QR-${id}`,
      role: 'cashier',
      maxDiscountPercent: 5,
      isActive: true,
      createdAt: new Date(),
    }) as EmployeeEntity;

  beforeEach(async () => {
    repo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ ...x, id: 'new-id' })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeesService,
        { provide: getRepositoryToken(EmployeeEntity), useValue: repo },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    service = module.get(EmployeesService);
  });

  const base = { firstName: 'A', lastName: 'B', email: 'a@b.com', role: 'cashier', storeId: 'store-1' };

  it('creates an employee when the PIN is free in the store', async () => {
    repo.find.mockResolvedValue([]); // no peers
    const res = await service.create({ ...base, pin: '1234' });
    expect(res.id).toBe('new-id');
    expect(repo.save).toHaveBeenCalled();
  });

  it('rejects a duplicate PIN within the same store (409)', async () => {
    repo.find.mockResolvedValue([await emp('e1', 'store-1', '1234')]);
    await expect(service.create({ ...base, pin: '1234' })).rejects.toThrow(ConflictException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('ALLOWS the same PIN in a DIFFERENT store', async () => {
    // store-2 has 1234, but we create in store-1 → find() for store-1 returns []
    repo.find.mockResolvedValue([]); // queried with where.storeId = store-1
    const res = await service.create({ ...base, storeId: 'store-1', pin: '1234' });
    expect(res.id).toBe('new-id');
    // confirm the uniqueness query was scoped to the creation store
    expect(repo.find).toHaveBeenCalledWith({ where: { storeId: 'store-1', isActive: true } });
  });

  it('rejects an invalid PIN format (too short / non-numeric)', async () => {
    await expect(service.create({ ...base, pin: '12' })).rejects.toThrow(BadRequestException);
    await expect(service.create({ ...base, pin: 'abcd' })).rejects.toThrow(BadRequestException);
  });

  it('changePin enforces uniqueness but ignores the employee itself', async () => {
    const self = await emp('me', 'store-1', '0000');
    repo.findOne.mockResolvedValue(self);
    // peers query excludes "me" via Not(id); simulate no other peer with 5678
    repo.find.mockResolvedValue([]);
    const res = await service.changePin('me', '5678', 'store-1');
    expect(res.message).toContain('mis à jour');
    expect(repo.update).toHaveBeenCalledWith('me', expect.objectContaining({ pinHash: expect.any(String) }));
  });

  it('changePin rejects a PIN already used by another employee in the store', async () => {
    repo.findOne.mockResolvedValue(await emp('me', 'store-1', '0000'));
    repo.find.mockResolvedValue([await emp('other', 'store-1', '5678')]);
    await expect(service.changePin('me', '5678', 'store-1')).rejects.toThrow(ConflictException);
  });

  it('changePin rejects a missing/invalid PIN', async () => {
    repo.findOne.mockResolvedValue(await emp('me', 'store-1', '0000'));
    await expect(service.changePin('me', undefined as any, 'store-1')).rejects.toThrow(BadRequestException);
  });

  it('changePin audits the action WITHOUT logging the PIN', async () => {
    repo.findOne.mockResolvedValue(await emp('target', 'store-1', '0000'));
    repo.find.mockResolvedValue([]);
    await service.changePin('target', '5678', 'store-1', 'admin-actor');

    expect(audit.log).toHaveBeenCalledTimes(1);
    const entry = audit.log.mock.calls[0][0];
    expect(entry.action).toBe('pin_changed');
    expect(entry.storeId).toBe('store-1');
    expect(entry.employeeId).toBe('admin-actor'); // actor, not target
    expect(entry.entityId).toBe('target');
    // The PIN must NEVER appear anywhere in the audit payload.
    expect(JSON.stringify(entry)).not.toContain('5678');
  });

  it('changePin still succeeds if the audit log throws (non-blocking)', async () => {
    repo.findOne.mockResolvedValue(await emp('t', 'store-1', '0000'));
    repo.find.mockResolvedValue([]);
    audit.log.mockRejectedValueOnce(new Error('audit down'));
    const res = await service.changePin('t', '5678', 'store-1', 'actor');
    expect(res.message).toContain('mis à jour');
  });
});
