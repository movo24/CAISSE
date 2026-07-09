/**
 * Decision 3 — brand/supplier catalogue. Store-scoped reference data, product
 * links, back-office filtering, and CSV round-trip (brand/supplier resolved by
 * name, created on demand).
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { ProductEntity } from '../src/database/entities/product.entity';
import { StoreEntity } from '../src/database/entities/store.entity';
import { PriceHistoryEntity } from '../src/database/entities/price-history.entity';
import { ProductCategoryEntity } from '../src/database/entities/product-category.entity';
import { BrandEntity } from '../src/database/entities/brand.entity';
import { SupplierEntity } from '../src/database/entities/supplier.entity';
import { StoreProductPriceEntity } from '../src/database/entities/store-product-price.entity';
import { ProductComponentEntity } from '../src/database/entities/product-component.entity';
import { AuditEntryEntity } from '../src/database/entities/audit-entry.entity';
import { AuditService } from '../src/modules/audit/audit.service';
import { ProductsService } from '../src/modules/products/products.service';
import { parseCsvWithHeader } from '../src/common/csv/csv.util';

describe('Decision 3 — brand / supplier catalogue', () => {
  let ds: DataSource;
  let svc: ProductsService;
  const STORE = uuidv4();
  const EMP = uuidv4();

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    await ds.getRepository(StoreEntity).save({ id: STORE, name: 'B43', isActive: true, currencyCode: 'EUR' } as any);
    svc = new ProductsService(
      ds.getRepository(ProductEntity),
      ds.getRepository(PriceHistoryEntity),
      ds.getRepository(ProductCategoryEntity),
      new AuditService(ds.getRepository(AuditEntryEntity), ds),
      ds.getRepository(BrandEntity),
      ds.getRepository(SupplierEntity),
      ds.getRepository(StoreProductPriceEntity),
      ds.getRepository(ProductComponentEntity),
    );
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('getOrCreate is idempotent by (store, name)', async () => {
    const b1 = await svc.getOrCreateBrand(STORE, 'Nike');
    const b2 = await svc.getOrCreateBrand(STORE, 'Nike'); // same → same row
    expect(b2.id).toBe(b1.id);
    expect(await ds.getRepository(BrandEntity).count({ where: { storeId: STORE } })).toBe(1);
    const s1 = await svc.getOrCreateSupplier(STORE, 'Grossiste Lyon');
    expect((await svc.listSuppliers(STORE)).map((s) => s.name)).toContain('Grossiste Lyon');
    expect(s1.id).toBeTruthy();
  });

  it('DECISIVE — a product links to brand+supplier and the catalog filters by them', async () => {
    const brand = await svc.getOrCreateBrand(STORE, 'Adidas');
    const supplier = await svc.getOrCreateSupplier(STORE, 'Importateur CN');
    await svc.create({ ean: '3601111111111', name: 'Sac', priceMinorUnits: 2000, taxRate: 20, storeId: STORE, brandId: brand.id, supplierId: supplier.id } as any, EMP);
    await svc.create({ ean: '3602222222222', name: 'Autre', priceMinorUnits: 1000, taxRate: 20, storeId: STORE } as any, EMP);

    const byBrand = await svc.findAll(STORE, { brandId: brand.id });
    expect(byBrand.data.map((p) => p.ean)).toEqual(['3601111111111']);
    const bySupplier = await svc.findAll(STORE, { supplierId: supplier.id });
    expect(bySupplier.data.map((p) => p.ean)).toEqual(['3601111111111']);
  });

  it('DECISIVE — CSV import resolves brand/supplier by name (created on demand); export emits them', async () => {
    const csv =
      'ean,name,price_minor_units,tax_rate,brand,supplier\n' +
      '3603333333333,Parfum,3000,20,Dior,Distributeur FR\n';
    const report = await svc.importCsv(STORE, csv, EMP);
    expect(report.created).toBe(1);
    // brand/supplier auto-created and linked
    const p = await svc.findByEan('3603333333333', STORE);
    const dior = (await svc.listBrands(STORE)).find((b) => b.name === 'Dior');
    expect(dior).toBeTruthy();
    expect(p!.brandId).toBe(dior!.id);

    // export carries the names; re-import is stable (no duplicate brand)
    const exported = await svc.exportCsv(STORE);
    const rows = parseCsvWithHeader(exported);
    const row = rows.find((r) => r.ean === '3603333333333')!;
    expect(row.brand).toBe('Dior');
    expect(row.supplier).toBe('Distributeur FR');
    await svc.importCsv(STORE, exported, EMP);
    expect((await svc.listBrands(STORE)).filter((b) => b.name === 'Dior')).toHaveLength(1); // idempotent
  });

  it('ADVERSE — an empty brand name is rejected', async () => {
    await expect(svc.getOrCreateBrand(STORE, '   ')).rejects.toThrow(/required/);
  });
});
