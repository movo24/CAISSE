/**
 * Affectation magasin à la création produit (P0 sync caisse).
 *
 * Bug corrigé : un produit créé avec le storeId du JWT admin (fallback
 * '_admin' quand l'admin n'a pas de magasin) n'existait pour AUCUNE caisse —
 * le catalogue POS (findAll) et le scan (findByEan) filtrent sur
 * products.store_id. Désormais :
 *  - le service REFUSE tout storeId absent ou ne correspondant à aucun
 *    magasin réel (BusinessError PRODUCT_STORE_REQUIRED, message actionnable) ;
 *  - le controller laisse un ADMIN cibler explicitement un magasin
 *    (dto.storeId) et force le magasin du JWT pour les autres rôles ;
 *  - un produit correctement affecté est visible par findAll ET findByEan
 *    du magasin cible — la chaîne back-office → caisse est prouvée ici.
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
import { ProductsController } from '../src/modules/products/products.controller';

describe('Affectation magasin à la création produit', () => {
  let ds: DataSource;
  let svc: ProductsService;
  const STORE_A = uuidv4();
  const STORE_B = uuidv4();
  const EMP = uuidv4();

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    await ds.getRepository(StoreEntity).save([
      { id: STORE_A, name: 'Magasin A', isActive: true, currencyCode: 'EUR' } as any,
      { id: STORE_B, name: 'Magasin B', isActive: true, currencyCode: 'EUR' } as any,
    ]);
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
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  const base = (ean: string) => ({
    ean,
    name: `Produit ${ean}`,
    priceMinorUnits: 100,
    taxRate: 5.5,
    status: 'active',
    isActive: true,
    stockQuantity: 10,
  });

  it("refuse un produit sans storeId — jamais de fiche orpheline", async () => {
    await expect(
      svc.create({ ...base('3760999000100') } as any, EMP),
    ).rejects.toMatchObject({ code: 'PRODUCT_STORE_REQUIRED' });
  });

  it("refuse le fallback '_admin' (magasin inexistant) avec un message actionnable", async () => {
    await expect(
      svc.create({ ...base('3760999000101'), storeId: '_admin' } as any, EMP),
    ).rejects.toMatchObject({ code: 'PRODUCT_STORE_REQUIRED' });
  });

  it('refuse un uuid de magasin inconnu', async () => {
    await expect(
      svc.create({ ...base('3760999000102'), storeId: uuidv4() } as any, EMP),
    ).rejects.toMatchObject({ code: 'PRODUCT_STORE_REQUIRED' });
  });

  it('un produit affecté au magasin A est visible par le catalogue ET le scan du magasin A — et invisible ailleurs', async () => {
    const ean = '3760999000777';
    const saved = await svc.create({ ...base(ean), storeId: STORE_A } as any, EMP);
    expect(saved.storeId).toBe(STORE_A);

    // Chaîne caisse : GET /products (catalogue) et GET /products/scan/:ean.
    const catalogueA = await svc.findAll(STORE_A, { limit: 200 });
    expect(catalogueA.data.map((p) => p.ean)).toContain(ean);
    const scanned = await svc.findByEan(ean, STORE_A);
    expect(scanned?.id).toBe(saved.id);

    // Isolation multi-tenant intacte : magasin B ne voit rien.
    const catalogueB = await svc.findAll(STORE_B, { limit: 200 });
    expect(catalogueB.data.map((p) => p.ean)).not.toContain(ean);
    await expect(svc.findByEan(ean, STORE_B)).resolves.toBeNull();
  });

  describe('controller — résolution du magasin cible', () => {
    const calls: any[] = [];
    const controller = new ProductsController({
      create: (data: any) => {
        calls.push(data);
        return Promise.resolve(data);
      },
    } as any);

    beforeEach(() => calls.splice(0));

    describe('endpoints :id — le contexte ADMIN suit le magasin RÉEL du produit (bug The Wesley Test)', () => {
      const updates: any[] = [];
      const ctrl = new ProductsController({
        // Le produit vit dans STORE_A ; l'admin a un JWT '_admin'.
        storeIdOfProduct: (id: string) => Promise.resolve(id === 'prod-1' ? STORE_A : null),
        update: (id: string, _d: any, _e: string, _r: any, storeId: string) => {
          updates.push({ id, storeId });
          return Promise.resolve({ id, storeId });
        },
        findOneForStore: (id: string, storeId: string) => Promise.resolve({ id, storeId }),
      } as any);
      beforeEach(() => updates.splice(0));

      it("ADMIN (JWT '_admin') : PUT /products/:id est routé vers le magasin du PRODUIT — plus jamais « belongs to another store »", async () => {
        await ctrl.update('prod-1', {} as any, {
          user: { role: 'admin', storeId: '_admin', employeeId: EMP },
          headers: {},
        });
        expect(updates[0].storeId).toBe(STORE_A);
      });

      it('ADMIN : GET /products/:id charge la fiche dans le magasin du produit', async () => {
        const res: any = await ctrl.findOne('prod-1', {
          user: { role: 'admin', storeId: '_admin', employeeId: EMP },
        });
        expect(res.storeId).toBe(STORE_A);
      });

      it('MANAGER : le contexte reste STRICTEMENT son magasin (isolation tenant intacte)', async () => {
        await ctrl.update('prod-1', {} as any, {
          user: { role: 'manager', storeId: STORE_B, employeeId: EMP },
          headers: {},
        });
        expect(updates[0].storeId).toBe(STORE_B);
      });

      it('ADMIN sur produit inexistant : retombe sur le magasin du JWT (404 standard en aval)', async () => {
        const res: any = await ctrl.findOne('prod-inconnu', {
          user: { role: 'admin', storeId: '_admin', employeeId: EMP },
        });
        expect(res.storeId).toBe('_admin');
      });
    });

    it("ADMIN + storeId explicite → le magasin CIBLE est utilisé", async () => {
      await controller.create({ storeId: STORE_A } as any, {
        user: { role: 'admin', storeId: '_admin', employeeId: EMP },
      });
      expect(calls[0].storeId).toBe(STORE_A);
    });

    it('ADMIN sans storeId explicite → magasin du JWT (comportement historique)', async () => {
      await controller.create({} as any, {
        user: { role: 'admin', storeId: STORE_B, employeeId: EMP },
      });
      expect(calls[0].storeId).toBe(STORE_B);
    });

    it('MANAGER : le storeId du body est IGNORÉ — magasin du JWT forcé', async () => {
      await controller.create({ storeId: STORE_A } as any, {
        user: { role: 'manager', storeId: STORE_B, employeeId: EMP },
      });
      expect(calls[0].storeId).toBe(STORE_B);
    });
  });
});
