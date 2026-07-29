/**
 * Projection légère du catalogue POS (P0-a — réduction transfert Railway).
 *
 * Le poll catalogue caisse (toutes les 15 s) demande `view=pos` → findAll avec
 * `lightImage: true`, qui EXCLUT `imageUrl` (data-URL base64, colonne `text`
 * lourde) de la réponse — la grille ne l'affiche pas, la vignette panier la
 * récupère à la demande. Tout autre appelant (back-office) garde l'image.
 *
 * Prouve : (1) lightImage retire imageUrl mais conserve les champs de vente ;
 * (2) le défaut (back-office) conserve imageUrl ; (3) l'exclusion ne casse ni
 * le filtrage ni le comptage.
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
import { ProductChangeLogEntity } from '../src/database/entities/product-change-log.entity';
import { ProductLinkEntity } from '../src/database/entities/product-link.entity';
import { AuditEntryEntity } from '../src/database/entities/audit-entry.entity';
import { AuditService } from '../src/modules/audit/audit.service';
import { ProductsService } from '../src/modules/products/products.service';

const BASE64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCA',
  STORE = uuidv4();

describe('Catalogue POS — projection légère sans imageUrl (view=pos)', () => {
  let ds: DataSource;
  let svc: ProductsService;

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    await ds.getRepository(StoreEntity).save({ id: STORE, name: 'S', isActive: true, currencyCode: 'EUR' } as any);
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
      ds.getRepository(ProductChangeLogEntity),
      ds.getRepository(ProductLinkEntity),
      ds.getRepository(StoreEntity),
    );
    await ds.getRepository(ProductEntity).save({
      id: uuidv4(), storeId: STORE, ean: '3760999123456', name: 'Coca 33cl',
      priceMinorUnits: 150, taxRate: 5.5, stockQuantity: 42, isActive: true,
      imageUrl: BASE64,
    } as any);
  });
  afterAll(async () => { await ds?.destroy(); });

  it('lightImage=true : imageUrl EXCLU, mais champs de vente conservés', async () => {
    const res = await svc.findAll(STORE, { lightImage: true, limit: 100 });
    expect(res.data).toHaveLength(1);
    const p = res.data[0];
    expect(p.imageUrl).toBeUndefined();          // la data-URL base64 n'est pas transférée
    expect(p.ean).toBe('3760999123456');         // champs indispensables à la vente présents
    expect(p.name).toBe('Coca 33cl');
    expect(p.priceMinorUnits).toBe(150);
    expect(p.stockQuantity).toBe(42);
    expect(res.meta.total).toBe(1);              // comptage intact
  });

  it('défaut (back-office) : imageUrl CONSERVÉ', async () => {
    const res = await svc.findAll(STORE, { limit: 100 });
    expect(res.data[0].imageUrl).toBe(BASE64);
  });

  it('lightImage n\'altère ni le filtre ni le tenant', async () => {
    const other = uuidv4();
    await ds.getRepository(StoreEntity).save({ id: other, name: 'Autre', isActive: true, currencyCode: 'EUR' } as any);
    const res = await svc.findAll(other, { lightImage: true, limit: 100 });
    expect(res.data).toHaveLength(0); // isolation magasin respectée
  });
});
