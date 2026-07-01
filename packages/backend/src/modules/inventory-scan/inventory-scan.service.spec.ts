import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { InventoryScanService } from './inventory-scan.service';
import { InventoryScanEntity } from '../../database/entities/inventory-scan.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { StoreEntity } from '../../database/entities/store.entity';
import { StockService } from '../stock/stock.service';
import { BusinessError } from '../../common/errors/business-error';

// PAQUET 258 — inventory scan service. DI-mocked. Locks: store validation,
// store_code requirement, offline idempotence (clientEntryId replay), matched vs
// new status, empty-apply early return, session stats roll-up. The atomic
// queryRunner path is exercised by inventory-adjust.spec + integration tests.

describe('InventoryScanService', () => {
  let service: InventoryScanService;
  let scanRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock; find: jest.Mock };
  let productRepo: { findOne: jest.Mock };
  let storeRepo: { findOne: jest.Mock };

  beforeEach(async () => {
    scanRepo = {
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 'scan-1', ...x })),
      find: jest.fn(),
    };
    productRepo = { findOne: jest.fn() };
    storeRepo = { findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryScanService,
        { provide: getRepositoryToken(InventoryScanEntity), useValue: scanRepo },
        { provide: getRepositoryToken(ProductEntity), useValue: productRepo },
        { provide: getRepositoryToken(StoreEntity), useValue: storeRepo },
        { provide: StockService, useValue: {} },
        { provide: DataSource, useValue: { createQueryRunner: jest.fn() } },
      ],
    }).compile();

    service = module.get(InventoryScanService);
  });

  describe('recordScan', () => {
    it('throws when the store does not exist', async () => {
      storeRepo.findOne.mockResolvedValue(null);
      await expect(
        service.recordScan('s1', 'e1', { barcode: '123' } as any),
      ).rejects.toMatchObject({ constructor: BusinessError, code: 'STORE_NOT_FOUND' });
    });

    it('throws INVALID_RELATION when the store has no store_code', async () => {
      storeRepo.findOne.mockResolvedValue({ id: 's1', storeCode: null });
      await expect(
        service.recordScan('s1', 'e1', { barcode: '123' } as any),
      ).rejects.toMatchObject({ code: 'INVALID_RELATION' });
    });

    it('is idempotent: replaying the same clientEntryId returns the stored scan', async () => {
      storeRepo.findOne.mockResolvedValue({ id: 's1', storeCode: 'ST1' });
      scanRepo.findOne.mockResolvedValue({ id: 'existing', barcode: '123' });
      const res = await service.recordScan('s1', 'e1', { barcode: '123', clientEntryId: 'k1' } as any);
      expect(res).toEqual({ id: 'existing', barcode: '123' });
      expect(scanRepo.save).not.toHaveBeenCalled();
    });

    it('records a matched scan when the product exists', async () => {
      storeRepo.findOne.mockResolvedValue({ id: 's1', storeCode: 'ST1' });
      scanRepo.findOne.mockResolvedValue(null);
      productRepo.findOne.mockResolvedValue({ id: 'p1', name: 'Bonbon' });
      const res = await service.recordScan('s1', 'e1', { barcode: '123', quantity: 3 } as any);
      expect(res).toMatchObject({ status: 'matched', productId: 'p1', productName: 'Bonbon', quantity: 3, storeCode: 'ST1' });
    });

    it('records a new scan when no product matches the barcode', async () => {
      storeRepo.findOne.mockResolvedValue({ id: 's1', storeCode: 'ST1' });
      scanRepo.findOne.mockResolvedValue(null);
      productRepo.findOne.mockResolvedValue(null);
      const res = await service.recordScan('s1', 'e1', { barcode: '999' } as any);
      expect(res.status).toBe('new');
      expect(res.quantity).toBe(1); // default
    });
  });

  describe('applyScansToStock', () => {
    it('returns {0,0} without opening a transaction when there is nothing to apply', async () => {
      scanRepo.find.mockResolvedValue([]);
      const res = await service.applyScansToStock('s1', 'e1');
      expect(res).toEqual({ applied: 0, skipped: 0 });
    });
  });

  describe('getSessionStats', () => {
    it('rolls up counts by status (pending = pending + matched)', async () => {
      scanRepo.find.mockResolvedValue([
        { status: 'matched' },
        { status: 'matched' },
        { status: 'new' },
        { status: 'applied' },
        { status: 'pending' },
      ]);
      const stats = await service.getSessionStats('s1', 'sess-1');
      expect(stats).toEqual({ total: 5, matched: 2, newProducts: 1, applied: 1, pending: 3 });
    });
  });
});
