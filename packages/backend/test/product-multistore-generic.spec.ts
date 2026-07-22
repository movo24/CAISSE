/**
 * Garantie GÉNÉRIQUE multi-magasins (owner 2026-07-23) — le correctif
 * « contexte admin = magasin du produit » n'est PAS spécifique à un magasin :
 *
 *  1. un admin travaille sur N'IMPORTE QUEL magasin de son périmètre ;
 *  2. la ressource conserve toujours son véritable storeId ;
 *  3. ses sous-entités/opérations utilisent ce même magasin ;
 *  4. tout NOUVEAU magasin (créé après coup, sans config) en bénéficie.
 *
 * Vrai ProductsController + vrai ProductsService sur pg-mem — les magasins
 * sont créés dynamiquement PENDANT le test (aucun nom/id en dur : le banc
 * d'essai « The Wesley Test » n'est pas une destination, juste un uuid parmi
 * d'autres). L'isolation stricte des non-admins est re-prouvée au passage.
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

describe('Générique multi-magasins — admin par produit, isolation par rôle', () => {
  let ds: DataSource;
  let svc: ProductsService;
  let ctrl: ProductsController;
  const EMP = uuidv4();

  /** Requête ADMIN dont le JWT ne porte AUCUN magasin réel (cas back-office). */
  const adminReq = { user: { role: 'admin', storeId: '_admin', employeeId: EMP }, headers: {} };

  const newStore = async (label: string): Promise<string> => {
    const id = uuidv4();
    await ds.getRepository(StoreEntity).save({
      id, name: `Magasin ${label} ${id.slice(0, 4)}`, isActive: true, currencyCode: 'EUR',
    } as any);
    return id;
  };

  /** EAN-13 interne valide et unique (clé de contrôle calculée). */
  let eanSeq = 0;
  const nextEan = (): string => {
    const body = `200${String(++eanSeq).padStart(9, '0')}`;
    const sum = body.split('').reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
    return body + String((10 - (sum % 10)) % 10);
  };

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
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
    ctrl = new ProductsController(svc);
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  /** Cycle fiche complet (création → lecture → maj → stock → prix magasin → média). */
  const fullLifecycleOn = async (storeId: string) => {
    const ean = nextEan();
    const created: any = await ctrl.create(
      {
        ean, name: `Produit ${ean}`, priceMinorUnits: 150, taxRate: 5.5,
        status: 'draft', stockQuantity: 0, storeId,
      } as any,
      adminReq,
    );
    // 2. La ressource porte son VÉRITABLE storeId dès la création.
    expect(created.storeId).toBe(storeId);

    // 1. L'admin relit/modifie la fiche SANS partager le magasin du JWT.
    const loaded: any = await ctrl.findOne(created.id, adminReq);
    expect(loaded.storeId).toBe(storeId);

    const updated: any = await ctrl.update(
      created.id,
      { priceMinorUnits: 250, stockQuantity: 9, status: 'active' } as any,
      adminReq,
    );
    expect(updated.storeId).toBe(storeId);
    expect(updated.stockQuantity).toBe(9);

    // 3. Sous-entités : prix magasin + média suivent le magasin du PRODUIT.
    await ctrl.setStorePrice(created.id, { priceMinorUnits: 199 } as any, adminReq);
    const override = await ds.getRepository(StoreProductPriceEntity).findOne({
      where: { productId: created.id },
    });
    expect(override?.storeId).toBe(storeId);

    await ctrl.addMedia(created.id, { url: 'https://exemple.test/img.png' } as any, adminReq);
    const media = await ds.getRepository(ProductMediaEntity).findOne({
      where: { productId: created.id },
    });
    expect(media?.storeId).toBe(storeId);

    // Publication : visible par le catalogue POS de SON magasin uniquement.
    const catalogue = await svc.findAll(storeId, { limit: 200 });
    expect(catalogue.data.map((p) => p.id)).toContain(created.id);
    return created.id;
  };

  it('1+2+3 — cycle complet valide sur PLUSIEURS magasins créés dynamiquement', async () => {
    const stores = await Promise.all([newStore('A'), newStore('B'), newStore('C')]);
    const ids: string[] = [];
    for (const storeId of stores) {
      ids.push(await fullLifecycleOn(storeId));
    }
    // Cloisonnement : chaque catalogue ne voit QUE son produit.
    for (let i = 0; i < stores.length; i++) {
      const cat = await svc.findAll(stores[i], { limit: 200 });
      for (let j = 0; j < ids.length; j++) {
        if (i === j) expect(cat.data.map((p) => p.id)).toContain(ids[j]);
        else expect(cat.data.map((p) => p.id)).not.toContain(ids[j]);
      }
    }
  });

  it('4 — un magasin créé APRÈS coup bénéficie de la même logique, sans aucune configuration', async () => {
    const futureStore = await newStore('FUTUR');
    await fullLifecycleOn(futureStore);
  });

  it('isolation NON-admin intacte : un manager d\'un autre magasin ne voit ni ne modifie la fiche', async () => {
    const storeX = await newStore('X');
    const storeY = await newStore('Y');
    const id = await fullLifecycleOn(storeX);
    const managerY = { user: { role: 'manager', storeId: storeY, employeeId: EMP }, headers: {} };

    await expect(ctrl.findOne(id, managerY)).rejects.toThrow(/not found|another store/i);
    await expect(
      ctrl.update(id, { priceMinorUnits: 1 } as any, managerY),
    ).rejects.toThrow(/not found|another store/i);
  });
});
