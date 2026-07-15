import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ProductsService } from './products.service';
import { ProductEntity } from '../../database/entities/product.entity';
import { PriceHistoryEntity } from '../../database/entities/price-history.entity';
import { ProductCategoryEntity } from '../../database/entities/product-category.entity';
import { BrandEntity } from '../../database/entities/brand.entity';
import { SupplierEntity } from '../../database/entities/supplier.entity';
import { StoreProductPriceEntity } from '../../database/entities/store-product-price.entity';
import { ProductComponentEntity } from '../../database/entities/product-component.entity';
import { ProductMediaEntity } from '../../database/entities/product-media.entity';
import { ProductDocumentEntity } from '../../database/entities/product-document.entity';
import { ProductBarcodeEntity } from '../../database/entities/product-barcode.entity';
import { ProductSupplierEntity } from '../../database/entities/product-supplier.entity';
import { ProductChangeLogEntity } from '../../database/entities/product-change-log.entity';
import { AuditService } from '../audit/audit.service';

/**
 * getStockAlerts pagination — the query must never load an unbounded set.
 * Limit defaults to 50, is clamped to [1, 100], and skip is derived from page.
 */
describe('ProductsService — getStockAlerts pagination', () => {
  let service: ProductsService;
  let qb: any;

  beforeEach(async () => {
    qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    const productRepo = { createQueryBuilder: jest.fn(() => qb) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: getRepositoryToken(ProductEntity), useValue: productRepo },
        { provide: getRepositoryToken(PriceHistoryEntity), useValue: {} },
        { provide: getRepositoryToken(ProductCategoryEntity), useValue: {} },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: getRepositoryToken(BrandEntity), useValue: {} },
        { provide: getRepositoryToken(SupplierEntity), useValue: {} },
        { provide: getRepositoryToken(StoreProductPriceEntity), useValue: {} },
        { provide: getRepositoryToken(ProductComponentEntity), useValue: {} },
        { provide: getRepositoryToken(ProductMediaEntity), useValue: {} },
        { provide: getRepositoryToken(ProductDocumentEntity), useValue: {} },
        { provide: getRepositoryToken(ProductBarcodeEntity), useValue: {} },
        { provide: getRepositoryToken(ProductSupplierEntity), useValue: {} },
        { provide: getRepositoryToken(ProductChangeLogEntity), useValue: {} },
      ],
    }).compile();
    service = module.get(ProductsService);
  });

  it('defaults to limit 50 / page 1 (skip 0)', async () => {
    await service.getStockAlerts('store-1');
    expect(qb.take).toHaveBeenCalledWith(50);
    expect(qb.skip).toHaveBeenCalledWith(0);
  });

  it('caps limit at 100 even when a larger value is requested', async () => {
    await service.getStockAlerts('store-1', { limit: 5000, page: 1 });
    expect(qb.take).toHaveBeenCalledWith(100);
  });

  it('clamps a non-positive limit up to 1', async () => {
    await service.getStockAlerts('store-1', { limit: 0 });
    expect(qb.take).toHaveBeenCalledWith(1);
  });

  it('derives skip from page and limit', async () => {
    await service.getStockAlerts('store-1', { page: 3, limit: 20 });
    expect(qb.skip).toHaveBeenCalledWith(40); // (3 - 1) * 20
    expect(qb.take).toHaveBeenCalledWith(20);
  });

  it('returns paginated rows plus totals and pagination meta', async () => {
    qb.getManyAndCount
      .mockResolvedValueOnce([[{ id: 'a' }], 7]) // alert query
      .mockResolvedValueOnce([[{ id: 'c' }], 3]); // critical query
    const res = await service.getStockAlerts('store-1', { page: 2, limit: 10 });
    expect(res.alert).toHaveLength(1);
    expect(res.critical).toHaveLength(1);
    expect(res.alertTotal).toBe(7);
    expect(res.criticalTotal).toBe(3);
    expect(res.page).toBe(2);
    expect(res.limit).toBe(10);
  });
});
