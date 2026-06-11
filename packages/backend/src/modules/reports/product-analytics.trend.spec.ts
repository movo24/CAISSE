import { DataSource, Repository } from 'typeorm';
import { createPgMemDataSource } from '../../../test/helpers/pgmem';
import { ProductAnalyticsService } from './product-analytics.service';
import { SaleEntity } from '../../database/entities/sale.entity';
import { SaleLineItemEntity } from '../../database/entities/sale-line-item.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { StoreEntity } from '../../database/entities/store.entity';

/**
 * Test de la COUCHE SERVICE (le gap signalé à l'audit) : prouve que le CA est
 * bucketé par jour commercial LOCAL du magasin, pas en UTC.
 */
describe('ProductAnalyticsService.getSalesTrend — bucketing jour local', () => {
  let ds: DataSource;
  let service: ProductAnalyticsService;
  let saleRepo: Repository<SaleEntity>;
  let storeId: string;

  beforeAll(async () => {
    ({ dataSource: ds } = createPgMemDataSource());
    await ds.initialize();
    saleRepo = ds.getRepository(SaleEntity);
    const storeRepo = ds.getRepository(StoreEntity);
    const store: StoreEntity = await storeRepo.save({
      name: 'Boutique Paris', storeCode: 'PAR-001', currencyCode: 'EUR', timezone: 'Europe/Paris',
    } as Partial<StoreEntity> as StoreEntity);
    storeId = store.id;

    service = new ProductAnalyticsService(
      saleRepo,
      ds.getRepository(SaleLineItemEntity),
      ds.getRepository(ProductEntity),
      storeRepo,
    );

    // Vente à 22:30 UTC le 07/06 = 00:30 le 08/06 à Paris (CEST) → jour local 08/06.
    await saveSaleAt('2026-06-07T22:30:00.000Z', 10000);
    // Vente le 06/06 (jour local 06/06) → baseline.
    await saveSaleAt('2026-06-06T10:00:00.000Z', 5000);
  });

  async function saveSaleAt(iso: string, total: number) {
    const s = await saleRepo.save({
      storeId, employeeId: 'emp-1', ticketNumber: `T-${total}`,
      status: 'completed', totalMinorUnits: total, currencyCode: 'EUR',
      hashChainPrev: '0'.repeat(64), hashChainCurrent: '0'.repeat(64),
    } as Partial<SaleEntity> as SaleEntity);
    // @CreateDateColumn force "now" à l'insert → on repositionne created_at.
    await saleRepo.update(s.id, { createdAt: new Date(iso) });
  }

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('range la vente nocturne sur le jour LOCAL (08/06), pas le jour UTC (07/06)', async () => {
    const now = new Date('2026-06-08T12:00:00.000Z'); // jour local 08/06
    const res = await service.getSalesTrend(storeId, now);

    expect(res.timeZone).toBe('Europe/Paris');
    // En UTC, la vente 22:30Z serait tombée le 07/06 → today=0. En local → 08/06.
    expect(res.comparisons.today.date).toBe('2026-06-08');
    expect(res.comparisons.today.caMinorUnits).toBe(10000);
    // 06/06 n'est ni J-1 (07/06) ni today : J-1 doit être 0.
    expect(res.comparisons.jMinus1.date).toBe('2026-06-07');
    expect(res.comparisons.jMinus1.caMinorUnits).toBe(0);
  });
});
