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

  it('(H4) rejects a payload containing offline sales (online-only V1)', async () => {
    // The offline raw-save door into `sales` is closed: it was the second,
    // un-sealed write path (no hash chain, no store lock) and forked the
    // fiscal chain. Sales must be created online via POST /sales (sealed).
    await expect(
      service.push(basePayload({ sales: [{ id: 'b' } as any] })),
    ).rejects.toThrow(BadRequestException);
    // No raw SaleEntity save is attempted.
    const savedSale = qr.manager.save.mock.calls.find((c: any[]) => c[0] === SaleEntity);
    expect(savedSale).toBeUndefined();
  });

  it('accepts a sales-free payload (customers/stock still sync)', async () => {
    const res = await service.push(basePayload({ sales: [] }));
    expect(res).toBeDefined();
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
});
