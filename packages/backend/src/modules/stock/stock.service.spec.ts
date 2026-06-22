import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ForbiddenException } from '@nestjs/common';

import { StockService } from './stock.service';
import { ProductEntity } from '../../database/entities/product.entity';
import { AuditService } from '../audit/audit.service';

describe('StockService — adjustStock', () => {
  let service: StockService;
  let manager: any;
  let audit: { log: jest.Mock };

  const product = () => ({ id: 'p1', storeId: 's1', name: 'Café', ean: '111', stockQuantity: 10 });

  beforeEach(async () => {
    manager = {
      findOne: jest.fn().mockResolvedValue(product()),
      save: jest.fn().mockImplementation((p: any) => Promise.resolve(p)),
    };
    const dataSource = { transaction: (fn: any) => fn(manager) } as unknown as DataSource;
    audit = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockService,
        { provide: getRepositoryToken(ProductEntity), useValue: {} },
        { provide: AuditService, useValue: audit },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();
    service = module.get(StockService);
  });

  it('absolute mode sets the exact quantity', async () => {
    const res = await service.adjustStock('p1', 42, 's1', 'e1', 'inventaire', 'absolute');
    expect(res.stockQuantity).toBe(42);
  });

  it('delta mode adds to the current quantity', async () => {
    const res = await service.adjustStock('p1', 5, 's1', 'e1', 'réappro', 'delta');
    expect(res.stockQuantity).toBe(15); // 10 + 5
  });

  it('never goes below zero (absolute or delta)', async () => {
    expect((await service.adjustStock('p1', -3, 's1', 'e1', 'x', 'absolute')).stockQuantity).toBe(0);
    expect((await service.adjustStock('p1', -50, 's1', 'e1', 'x', 'delta')).stockQuantity).toBe(0);
  });

  it('throws when the product is not found / cross-store', async () => {
    manager.findOne.mockResolvedValue(null);
    await expect(service.adjustStock('p1', 1, 's1', 'e1', 'x')).rejects.toThrow(ForbiddenException);
  });

  it('audits the adjustment with old/new quantities', async () => {
    await service.adjustStock('p1', 20, 's1', 'e1', 'inventaire', 'absolute');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'stock_adjustment',
        details: expect.objectContaining({ oldQuantity: 10, newQuantity: 20, mode: 'absolute' }),
      }),
    );
  });

  it('PHANTOM-FIX (D16 class 3) — audit is post-commit best-effort: an audit failure does NOT fail/roll back the adjustment', async () => {
    audit.log.mockRejectedValueOnce(new Error('audit down'));
    // Before the fix, audit ran INSIDE the tx → a throw rolled the adjustment back and
    // adjustStock rejected. Now audit is emitted AFTER commit (best-effort) → the
    // adjustment still applies and the call resolves.
    const res = await service.adjustStock('p1', 42, 's1', 'e1', 'inventaire', 'absolute');
    expect(res.stockQuantity).toBe(42);
    expect(manager.save).toHaveBeenCalled();
  });
});
