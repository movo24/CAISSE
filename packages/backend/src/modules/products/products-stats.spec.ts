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
import { ProductLinkEntity } from '../../database/entities/product-link.entity';
import { AuditService } from '../audit/audit.service';

/**
 * P-D — getProductStats : mise en forme des agrégats réels. On mocke `manager.query`
 * (4 requêtes séquentielles : résumé, panier, rang, série) pour verrouiller la logique
 * JS (marge coût-courant labellisée, rang borné, cas zéro-vente).
 */
async function build(product: any, queryImpl: jest.Mock) {
  const productRepo = { findOne: jest.fn().mockResolvedValue(product), manager: { query: queryImpl } };
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
      { provide: getRepositoryToken(ProductLinkEntity), useValue: {} },
    ],
  }).compile();
  return module.get(ProductsService) as ProductsService;
}

describe('ProductsService.getProductStats (P-D)', () => {
  it('agrège et met en forme des ventes réelles (marge coût-courant, rang, série)', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([{ sales_count: 3, total_units: 10, total_revenue: 12000, revenue_ht: 10000, first_sale: '2026-06-01T00:00:00Z', last_sale: '2026-07-10T00:00:00Z' }])
      .mockResolvedValueOnce([{ avg_basket: 4000 }])
      .mockResolvedValueOnce([{ ranked: 20, my_rev: 12000, rnk: 3 }])
      .mockResolvedValueOnce([{ wk: '2026-07-06', units: 4, revenue: 4800 }]);
    const svc = await build({ id: 'p1', storeId: 's1', costMinorUnits: 500 }, query);

    const r = await svc.getProductStats('p1', 's1');
    expect(r.salesCount).toBe(3);
    expect(r.totalUnits).toBe(10);
    expect(r.totalRevenueMinorUnits).toBe(12000);
    expect(r.avgBasketMinorUnits).toBe(4000);
    // marge = revenue_ht (10000) - cost(500) * units(10) = 5000
    expect(r.estimatedMarginMinorUnits).toBe(5000);
    expect(r.costBasis).toBe('current');
    expect(r.rank).toBe(3);
    expect(r.rankedProducts).toBe(20);
    expect(r.weekly).toEqual([{ weekStart: '2026-07-06', units: 4, revenueMinorUnits: 4800 }]);
  });

  it('produit sans vente : tout à 0/null, jamais simulé', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([{ sales_count: 0, total_units: 0, total_revenue: 0, revenue_ht: 0, first_sale: null, last_sale: null }])
      .mockResolvedValueOnce([{ avg_basket: 0 }])
      .mockResolvedValueOnce([{ ranked: 20, my_rev: null, rnk: 21 }])
      .mockResolvedValueOnce([]);
    const svc = await build({ id: 'p1', storeId: 's1', costMinorUnits: 500 }, query);

    const r = await svc.getProductStats('p1', 's1');
    expect(r.totalUnits).toBe(0);
    expect(r.estimatedMarginMinorUnits).toBeNull();
    expect(r.costBasis).toBe('unavailable');
    expect(r.rank).toBeNull(); // my_rev null → pas de rang
    expect(r.firstSaleAt).toBeNull();
    expect(r.weekly).toEqual([]);
  });

  it('coût inconnu : marge non calculée (costBasis unavailable)', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([{ sales_count: 1, total_units: 2, total_revenue: 2000, revenue_ht: 1667, first_sale: '2026-07-01T00:00:00Z', last_sale: '2026-07-01T00:00:00Z' }])
      .mockResolvedValueOnce([{ avg_basket: 2000 }])
      .mockResolvedValueOnce([{ ranked: 5, my_rev: 2000, rnk: 1 }])
      .mockResolvedValueOnce([]);
    const svc = await build({ id: 'p1', storeId: 's1', costMinorUnits: null }, query);

    const r = await svc.getProductStats('p1', 's1');
    expect(r.estimatedMarginMinorUnits).toBeNull();
    expect(r.costBasis).toBe('unavailable');
    expect(r.rank).toBe(1);
  });
});
