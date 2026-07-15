/**
 * Bloc 4i (POS mission) — product CSV bulk import/export. Decisive: import
 * upserts by (ean, store) reusing update() so price history + audit hold; a bad
 * row is SKIPPED and reported (never silently dropped); export round-trips back
 * through import without creating duplicates.
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
import { ProductMediaEntity } from '../src/database/entities/product-media.entity';
import { ProductDocumentEntity } from '../src/database/entities/product-document.entity';
import { ProductBarcodeEntity } from '../src/database/entities/product-barcode.entity';
import { ProductSupplierEntity } from '../src/database/entities/product-supplier.entity';
import { AuditEntryEntity } from '../src/database/entities/audit-entry.entity';
import { AuditService } from '../src/modules/audit/audit.service';
import { ProductsService } from '../src/modules/products/products.service';
import { parseCsvWithHeader } from '../src/common/csv/csv.util';

describe('Bloc 4i — product CSV import/export', () => {
  let ds: DataSource;
  let svc: ProductsService;
  const STORE = uuidv4();
  const EMP = uuidv4();

  const countProducts = () => ds.getRepository(ProductEntity).count({ where: { storeId: STORE } });

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
      ds.getRepository(ProductMediaEntity),
      ds.getRepository(ProductDocumentEntity),
      ds.getRepository(ProductBarcodeEntity),
      ds.getRepository(ProductSupplierEntity),
    );
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('DECISIVE — imports valid rows, SKIPS+REPORTS the bad one (no silent drop)', async () => {
    const csv =
      'ean,name,price_minor_units,tax_rate,cost_minor_units\n' +
      '3600000000017,Bonbon,500,20,200\n' +
      '3600000000024,Sucette,150,5.5,\n' +
      '3600000000031,Cassé,abc,20,\n'; // bad price → skipped
    const report = await svc.importCsv(STORE, csv, EMP);
    expect(report).toMatchObject({ total: 3, created: 2, updated: 0, skipped: 1 });
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatchObject({ ean: '3600000000031' });
    expect(report.errors[0].reason).toMatch(/price_minor_units invalide/);
    expect(await countProducts()).toBe(2);
    const bonbon = await svc.findByEan('3600000000017', STORE);
    expect(bonbon).toMatchObject({ name: 'Bonbon', priceMinorUnits: 500, costMinorUnits: 200 });
  });

  it('DECISIVE — re-import UPDATES by (ean,store) and writes price history on a price change', async () => {
    const csv =
      'ean,name,price_minor_units,tax_rate\n' +
      '3600000000017,Bonbon,650,20\n' + // price changed 500 → 650
      '3600000000048,Chocolat,300,20\n'; // new
    const report = await svc.importCsv(STORE, csv, EMP);
    expect(report).toMatchObject({ created: 1, updated: 1, skipped: 0 });
    expect(await countProducts()).toBe(3); // no duplicate for the updated EAN
    const bonbon = await svc.findByEan('3600000000017', STORE);
    expect(bonbon!.priceMinorUnits).toBe(650);
    const history = await ds.getRepository(PriceHistoryEntity).find({ where: { productId: bonbon!.id } });
    expect(history.some((h) => h.changeSource === 'csv_import' && h.newPriceMinorUnits === 650)).toBe(true);
  });

  it('ADVERSE — rows missing ean or name are skipped with a clear reason', async () => {
    const csv =
      'ean,name,price_minor_units\n' +
      ',Orphelin,100\n' + // no ean
      '3600000000055,,100\n'; // no name
    const report = await svc.importCsv(STORE, csv, EMP);
    expect(report.created).toBe(0);
    expect(report.skipped).toBe(2);
    expect(report.errors.map((e) => e.reason).sort()).toEqual(['ean manquant', 'name manquant']);
  });

  it('DECISIVE — export round-trips through import: no duplicates, catalog stable', async () => {
    const before = await countProducts();
    const csv = await svc.exportCsv(STORE);
    const parsed = parseCsvWithHeader(csv);
    expect(parsed.length).toBe(before); // one row per active product
    expect(Object.keys(parsed[0])).toEqual(['ean', 'name', 'price_minor_units', 'tax_rate', 'cost_minor_units', 'unit_type', 'is_active', 'brand', 'supplier']);
    // re-importing the export is idempotent on count (all updates, zero creates)
    const report = await svc.importCsv(STORE, csv, EMP);
    expect(report.created).toBe(0);
    expect(report.updated).toBe(before);
    expect(await countProducts()).toBe(before);
  });
});
