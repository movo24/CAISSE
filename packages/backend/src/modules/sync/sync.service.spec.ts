import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BadRequestException } from '@nestjs/common';

import { SyncService, SyncPushPayload } from './sync.service';
import { SaleEntity } from '../../database/entities/sale.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { CustomerEntity } from '../../database/entities/customer.entity';
import { AuditService } from '../audit/audit.service';

describe('SyncService — push', () => {
  let service: SyncService;
  let qr: any;
  let existingSales: any[];
  let existingCustomers: any[];

  const basePayload = (over: Partial<SyncPushPayload> = {}): SyncPushPayload => ({
    storeId: 's1', deviceId: 'd1', lastSyncAt: '2026-06-01T00:00:00Z',
    sales: [], customers: [], stockAdjustments: [], ...over,
  });

  beforeEach(async () => {
    existingSales = [];
    existingCustomers = [];
    qr = {
      connect: jest.fn(), startTransaction: jest.fn(), commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(), release: jest.fn(),
      manager: {
        find: jest.fn().mockImplementation((entity: any) =>
          Promise.resolve(entity === SaleEntity ? existingSales : existingCustomers),
        ),
        save: jest.fn().mockResolvedValue(undefined),
      },
    };
    const dataSource = { createQueryRunner: () => qr } as unknown as DataSource;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SyncService,
        { provide: getRepositoryToken(SaleEntity), useValue: {} },
        { provide: getRepositoryToken(ProductEntity), useValue: {} },
        { provide: getRepositoryToken(CustomerEntity), useValue: {} },
        { provide: DataSource, useValue: dataSource },
        { provide: AuditService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    service = module.get(SyncService);
  });

  it('rejects a payload without storeId / deviceId', async () => {
    await expect(service.push(basePayload({ storeId: '' }))).rejects.toThrow(BadRequestException);
  });

  it('rejects non-integer or out-of-range stock deltas', async () => {
    await expect(service.push(basePayload({ stockAdjustments: [{ productId: 'p', delta: 1.5, reason: 'x' }] }))).rejects.toThrow(BadRequestException);
    await expect(service.push(basePayload({ stockAdjustments: [{ productId: 'p', delta: 999999, reason: 'x' }] }))).rejects.toThrow(BadRequestException);
  });

  it('deduplicates already-synced sales (idempotent replay)', async () => {
    existingSales = [{ id: 'a' }]; // 'a' already on the server
    const res = await service.push(basePayload({ sales: [{ id: 'a' } as any, { id: 'b' } as any] }));
    expect(res.accepted).toBe(1); // only 'b' is new
    const savedArg = qr.manager.save.mock.calls.find((c: any[]) => c[0] === SaleEntity)?.[1];
    expect(savedArg.map((s: any) => s.id)).toEqual(['b']);
    expect(qr.commitTransaction).toHaveBeenCalled();
  });

  it('flags a customer conflict (server_wins) when the server copy is newer', async () => {
    existingCustomers = [{ id: 'c1', loyaltyPoints: 50, updatedAt: new Date('2026-06-05T00:00:00Z') }];
    const res = await service.push(
      basePayload({ customers: [{ id: 'c1', loyaltyPoints: 10 } as any] }),
    );
    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0]).toMatchObject({ entity: 'customer', entityId: 'c1', resolution: 'server_wins' });
  });

  // ── SECURITY (M403 follow-up): per-row storeId cannot forge cross-store writes ──
  it('DECISIVE — forces a synced sale into the payload store (ignores a claimed other store)', async () => {
    const res = await service.push(basePayload({ storeId: 's1', sales: [{ id: 'x', storeId: 's2', totalMinorUnits: 999 } as any] }));
    expect(res.accepted).toBe(1);
    const saved = qr.manager.save.mock.calls.find((c: any[]) => c[0] === SaleEntity)?.[1];
    expect(saved[0].storeId).toBe('s1'); // forged 's2' overwritten with the resolved store
  });

  it('DECISIVE — refuses to touch a customer owned by ANOTHER store (id-guessing hijack)', async () => {
    existingCustomers = [{ id: 'c2', storeId: 's2', loyaltyPoints: 5, updatedAt: new Date('2020-01-01T00:00:00Z') }];
    const res = await service.push(basePayload({ storeId: 's1', customers: [{ id: 'c2', loyaltyPoints: 99999 } as any] }));
    expect(res.conflicts.some((c) => c.entityId === 'c2' && c.field === 'storeId')).toBe(true);
    expect(qr.manager.save.mock.calls.find((c: any[]) => c[0] === CustomerEntity)).toBeUndefined(); // never saved
  });

  it('forces storeId on a NEW synced customer', async () => {
    const res = await service.push(basePayload({ storeId: 's1', customers: [{ id: 'cnew', loyaltyPoints: 3 } as any] }));
    expect(res.accepted).toBe(1);
    const saved = qr.manager.save.mock.calls.find((c: any[]) => c[0] === CustomerEntity)?.[1];
    expect(saved[0].storeId).toBe('s1');
  });
});
