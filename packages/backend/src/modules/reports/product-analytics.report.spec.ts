import { DataSource, Repository } from 'typeorm';
import { createPgMemDataSource } from '../../../test/helpers/pgmem';
import { ProductAnalyticsService } from './product-analytics.service';
import { SaleEntity } from '../../database/entities/sale.entity';
import { SaleLineItemEntity } from '../../database/entities/sale-line-item.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { StoreEntity } from '../../database/entities/store.entity';

/**
 * Test d'INTÉGRATION (couche service) prouvant que la chaîne ventes → service
 * produit des DONNÉES EXPLOITABLES par l'écran : top trié, CA + marge calculés,
 * réassort détecté, dormant détecté. C'est la preuve « produit », pas un mock.
 */
describe('ProductAnalyticsService.getReport — données exploitables (intégration)', () => {
  let ds: DataSource;
  let service: ProductAnalyticsService;
  let saleRepo: Repository<SaleEntity>;
  let lineRepo: Repository<SaleLineItemEntity>;
  let productRepo: Repository<ProductEntity>;
  let storeId: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ({ dataSource: ds } = createPgMemDataSource());
    await ds.initialize();
    saleRepo = ds.getRepository(SaleEntity);
    lineRepo = ds.getRepository(SaleLineItemEntity);
    productRepo = ds.getRepository(ProductEntity);
    const storeRepo = ds.getRepository(StoreEntity);
    const store: StoreEntity = await storeRepo.save({ name: 'S', storeCode: 'S1', currencyCode: 'EUR', timezone: 'Europe/Paris' } as Partial<StoreEntity> as StoreEntity);
    storeId = store.id;
    service = new ProductAnalyticsService(saleRepo, lineRepo, productRepo, storeRepo);

    ids.star = (await productRepo.save({ name: 'Star', ean: 'E-STAR', priceMinorUnits: 1000, costMinorUnits: 600, stockQuantity: 300, storeId, isActive: true, barcodeSource: 'manual' } as any)).id;
    ids.reorder = (await productRepo.save({ name: 'Reorder', ean: 'E-REO', priceMinorUnits: 500, costMinorUnits: 300, stockQuantity: 5, storeId, isActive: true, barcodeSource: 'manual' } as any)).id;
    ids.dormant = (await productRepo.save({ name: 'Dormant', ean: 'E-DOR', priceMinorUnits: 800, costMinorUnits: 480, stockQuantity: 10, storeId, isActive: true, barcodeSource: 'manual' } as any)).id;

    // Ventes des 7 derniers jours : Star 100u, Reorder 30u, Dormant 0u.
    await sell(ids.star, 'Star', 1000, 100);
    await sell(ids.reorder, 'Reorder', 500, 30);
  });

  async function sell(productId: string, name: string, price: number, units: number) {
    const when = new Date(Date.now() - 2 * 86_400_000); // il y a 2 jours
    const sale = await saleRepo.save({ storeId, employeeId: 'e', ticketNumber: `T-${name}`, status: 'completed', totalMinorUnits: price * units, currencyCode: 'EUR' } as Partial<SaleEntity> as SaleEntity);
    await saleRepo.update(sale.id, { createdAt: when } as any);
    await lineRepo.save({ saleId: sale.id, productId, productName: name, ean: 'E', quantity: units, unitPriceMinorUnits: price, lineTotalMinorUnits: price * units, taxRate: 20 } as Partial<SaleLineItemEntity> as SaleLineItemEntity);
  }

  afterAll(async () => { if (ds?.isInitialized) await ds.destroy(); });

  it('top trié par ventes, avec CA et marge réels', async () => {
    const r = await service.getReport(storeId, new Date());
    expect(r.top[0].name).toBe('Star');
    const star = r.top.find((i) => i.name === 'Star')!;
    expect(star.unitsSold30d).toBe(100);
    expect(star.revenue30dMinorUnits).toBe(100000); // 100 × 1000
    expect(star.marginPct).toBe(40); // (100000 − 600×100) / 100000
  });

  it('réassort détecté pour stock bas + forte vélocité', async () => {
    const r = await service.getReport(storeId, new Date());
    const reo = r.reorder.find((i) => i.name === 'Reorder');
    expect(reo).toBeDefined();
    expect(reo!.daysUntilStockout).toBeLessThanOrEqual(7);
    expect(reo!.suggestedReorderQty).toBeGreaterThan(0);
  });

  it('dormant détecté (en stock, aucune vente)', async () => {
    const r = await service.getReport(storeId, new Date());
    expect(r.dormant.map((i) => i.name)).toContain('Dormant');
  });
});
