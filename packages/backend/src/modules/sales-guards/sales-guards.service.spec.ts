import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { SalesGuardsService } from './sales-guards.service';
import { SalesGuardsConfigProvider } from './sales-guards.config';
import { SaleAnomalyLogEntity } from '../../database/entities/sale-anomaly-log.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { GUARD_CODE } from './sales-guards.types';

/**
 * Validates the SERVER-SIDE enrichment path: the POS sends only productId +
 * quantity (+ optional sell/discount); the service fills cost/catalogue from
 * the product table before running the pure engine.
 */
describe('SalesGuardsService.evaluate (enrichment)', () => {
  let service: SalesGuardsService;
  const products: Record<string, Partial<ProductEntity>> = {
    'prod-below': { id: 'prod-below', ean: '111', name: 'X', priceMinorUnits: 100, costMinorUnits: 120, storeId: 'store-1' },
    'prod-nocost': { id: 'prod-nocost', ean: '222', name: 'Y', priceMinorUnits: 200, costMinorUnits: null as any, storeId: 'store-1' },
  };

  const qb = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesGuardsService,
        {
          provide: getRepositoryToken(SaleAnomalyLogEntity),
          useValue: {
            create: jest.fn((x) => x),
            save: jest.fn(async (x) => ({ ...x, id: 'anomaly-1' })),
          },
        },
        {
          provide: getRepositoryToken(ProductEntity),
          useValue: { createQueryBuilder: jest.fn(() => qb) },
        },
        SalesGuardsConfigProvider, // real config, env defaults
      ],
    }).compile();

    service = module.get(SalesGuardsService);
    jest.clearAllMocks();
  });

  it('enriches cost from the product → detects SALE_BELOW_COST', async () => {
    qb.getMany.mockResolvedValue([products['prod-below']]);

    const res = await service.evaluate({
      storeId: 'store-1',
      sellerId: 'seller-1',
      items: [{ productId: 'prod-below', quantity: 1 }], // no cost/catalog supplied
    });

    const a = res.results.find((r) => r.code === GUARD_CODE.SALE_BELOW_COST);
    expect(a).toBeDefined();
    expect(res.hasBlocking).toBe(true);
    expect(res.requiresManagerApproval).toBe(true);
    expect(res.anomalyIds).toContain('anomaly-1');
  });

  it('product with null cost → COST_MISSING, non-blocking', async () => {
    qb.getMany.mockResolvedValue([products['prod-nocost']]);

    const res = await service.evaluate({
      storeId: 'store-1',
      sellerId: 'seller-1',
      items: [{ productId: 'prod-nocost', quantity: 1 }],
    });

    expect(res.results.some((r) => r.code === GUARD_CODE.COST_MISSING)).toBe(true);
    expect(res.hasBlocking).toBe(false);
  });
});
