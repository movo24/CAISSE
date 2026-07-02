import { DataSource, Repository } from 'typeorm';
import { ConflictException, ForbiddenException } from '@nestjs/common';

import { createPgMemDataSource } from '../../../test/helpers/pgmem';
import { ProductsService } from './products.service';
import { ProductEntity } from '../../database/entities/product.entity';
import { PriceHistoryEntity } from '../../database/entities/price-history.entity';
import { ProductCategoryEntity } from '../../database/entities/product-category.entity';
import { StoreEntity } from '../../database/entities/store.entity';
import { SupplierEntity } from '../../database/entities/supplier.entity';

// PAQUET 298 (bloc C2) — ProductsService against a real in-memory Postgres:
// the catalogue-integrity rules proven on real SQL — POS-066 normalized-name
// dedup (per store), the (ean, store_id) UNIQUE index as last-resort guard,
// rename keeping normalized_name in sync, tenant/active/ILIKE search, and the
// price-history + audit side-effects of a price change.

describe('ProductsService (pg-mem)', () => {
  let dataSource: DataSource;
  let productRepo: Repository<ProductEntity>;
  let historyRepo: Repository<PriceHistoryEntity>;
  let service: ProductsService;
  const auditLog = jest.fn().mockResolvedValue(undefined);

  let storeId: string;
  let otherStoreId: string;

  beforeAll(async () => {
    const built = createPgMemDataSource();
    dataSource = built.dataSource;
    await dataSource.initialize();
    productRepo = dataSource.getRepository(ProductEntity);
    historyRepo = dataSource.getRepository(PriceHistoryEntity);
    service = new ProductsService(
      productRepo,
      historyRepo,
      dataSource.getRepository(ProductCategoryEntity),
      dataSource.getRepository(SupplierEntity),
      { log: auditLog } as any, // audit hash-chain has its own suites
    );
    const storeRepo = dataSource.getRepository(StoreEntity);
    storeId = (await storeRepo.save(storeRepo.create({ name: 'Wesley' }))).id;
    otherStoreId = (await storeRepo.save(storeRepo.create({ name: 'Other' }))).id;
  });

  beforeEach(() => auditLog.mockClear());

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('POS-066: refuses a duplicate NORMALIZED name in the same store (accents/case/spaces folded)', async () => {
    await service.create({ storeId, ean: 'E-1', name: 'Réglisse  Géante', priceMinorUnits: 100 } as any, 'emp-1');
    await expect(
      service.create({ storeId, ean: 'E-2', name: 'reglisse geante', priceMinorUnits: 100 } as any, 'emp-1'),
    ).rejects.toThrow(ConflictException);
  });

  it('the SAME name in ANOTHER store is allowed (dedup is per store)', async () => {
    const p = await service.create(
      { storeId: otherStoreId, ean: 'E-1', name: 'Réglisse Géante', priceMinorUnits: 100 } as any,
      'emp-1',
    );
    expect(p.id).toBeTruthy();
  });

  it('the (ean, store_id) UNIQUE index is the DB last-resort guard against duplicate EANs', async () => {
    await service.create({ storeId, ean: 'E-UNIQ', name: 'Fraise Tagada', priceMinorUnits: 100 } as any, 'emp-1');
    // bypass the service (raw repo save) → the DB constraint itself must refuse
    await expect(
      productRepo.save(
        productRepo.create({ storeId, ean: 'E-UNIQ', name: 'Autre nom', priceMinorUnits: 100 } as Partial<ProductEntity>),
      ),
    ).rejects.toThrow();
  });

  it('rename keeps normalized_name in sync so dedup stays correct after updates', async () => {
    const p = await service.create({ storeId, ean: 'E-3', name: 'Ourson Or', priceMinorUnits: 100 } as any, 'emp-1');
    await service.update(p.id, { name: 'Ourson Argenté' } as any, 'emp-1', undefined, storeId);
    // the OLD name is free again…
    const again = await service.create({ storeId, ean: 'E-4', name: 'ourson or', priceMinorUnits: 100 } as any, 'emp-1');
    expect(again.id).toBeTruthy();
    // …and the NEW name is now taken
    await expect(
      service.create({ storeId, ean: 'E-5', name: 'OURSON  argenté', priceMinorUnits: 100 } as any, 'emp-1'),
    ).rejects.toThrow(ConflictException);
  });

  it('a price change writes price history + audit; a no-op update writes neither', async () => {
    const p = await service.create({ storeId, ean: 'E-6', name: 'Cola bouteille', priceMinorUnits: 200 } as any, 'emp-1');
    auditLog.mockClear();

    await service.update(p.id, { priceMinorUnits: 250 } as any, 'emp-1', 'inflation', storeId, 'backoffice', 'manager');
    const rows = await historyRepo.find({ where: { productId: p.id } as any });
    expect(rows).toHaveLength(1);
    expect(rows[0].oldPriceMinorUnits).toBe(200);
    expect(rows[0].newPriceMinorUnits).toBe(250);
    expect(auditLog).toHaveBeenCalledTimes(1);

    auditLog.mockClear();
    await service.update(p.id, { description: 'juste une description' } as any, 'emp-1', undefined, storeId);
    expect(await historyRepo.count({ where: { productId: p.id } as any })).toBe(1); // unchanged
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('findAll is tenant-scoped, active-only, ILIKE-searchable, with real pagination totals', async () => {
    await service.create({ storeId, ean: 'E-7', name: 'Zèbre acidulé', priceMinorUnits: 100 } as any, 'emp-1');
    const inactive = await service.create({ storeId, ean: 'E-8', name: 'Produit retiré', priceMinorUnits: 100 } as any, 'emp-1');
    await productRepo.update(inactive.id, { isActive: false });

    const all = await service.findAll(storeId);
    expect(all.data.every((p) => p.storeId === storeId && p.isActive)).toBe(true);
    expect(all.data.some((p) => p.id === inactive.id)).toBe(false);

    const search = await service.findAll(storeId, { search: 'zèbre' }); // ILIKE, case-insensitive
    expect(search.data.map((p) => p.name)).toEqual(['Zèbre acidulé']);
    expect(search.meta.total).toBe(1);
  });

  // ── Cycle P — intégrité des références catalogue (tenant + métier) ────────

  describe('Cycle P — supplierId / parentProductId validés (SQL réel)', () => {
    let supplierRepo: Repository<SupplierEntity>;
    let mySupplier: SupplierEntity;
    let foreignSupplier: SupplierEntity;

    beforeAll(async () => {
      supplierRepo = dataSource.getRepository(SupplierEntity);
      mySupplier = await supplierRepo.save(
        supplierRepo.create({ storeId, name: 'Fournisseur Wesley', isActive: true }),
      );
      foreignSupplier = await supplierRepo.save(
        supplierRepo.create({ storeId: otherStoreId, name: 'Fournisseur Autre', isActive: true }),
      );
    });

    it('refuse un fournisseur d’un AUTRE magasin (cross-tenant)', async () => {
      await expect(
        service.create(
          { storeId, ean: 'P-1', name: 'Prod X-Tenant', priceMinorUnits: 100, supplierId: foreignSupplier.id } as any,
          'emp-1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuse un fournisseur inexistant', async () => {
      await expect(
        service.create(
          { storeId, ean: 'P-2', name: 'Prod Ghost', priceMinorUnits: 100, supplierId: '00000000-0000-4000-8000-00000000dead' } as any,
          'emp-1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('accepte un fournisseur actif du magasin ; refuse une NOUVELLE assignation vers un désactivé', async () => {
      const ok = await service.create(
        { storeId, ean: 'P-3', name: 'Prod Fourni', priceMinorUnits: 100, supplierId: mySupplier.id } as any,
        'emp-1',
      );
      expect(ok.supplierId).toBe(mySupplier.id);

      await supplierRepo.update(mySupplier.id, { isActive: false });
      await expect(
        service.create(
          { storeId, ean: 'P-4', name: 'Prod Fourni 2', priceMinorUnits: 100, supplierId: mySupplier.id } as any,
          'emp-1',
        ),
      ).rejects.toThrow(ConflictException);

      // La référence EXISTANTE reste modifiable tant qu'on ne change pas le fournisseur
      // (update sans changement de supplierId ne re-valide pas la référence).
      const renamed = await service.update(
        ok.id,
        { description: 'toujours lié au fournisseur désactivé', supplierId: mySupplier.id } as any,
        'emp-1', undefined, storeId,
      );
      expect(renamed.supplierId).toBe(mySupplier.id);
      await supplierRepo.update(mySupplier.id, { isActive: true }); // restore
    });

    it('parentProductId : refuse parent inexistant / autre magasin / auto-parent / variante-de-variante', async () => {
      const parent = await service.create(
        { storeId, ean: 'P-5', name: 'Parent Cola', priceMinorUnits: 100 } as any, 'emp-1',
      );
      const variant = await service.create(
        { storeId, ean: 'P-6', name: 'Cola 33cl', priceMinorUnits: 100, parentProductId: parent.id } as any, 'emp-1',
      );
      expect(variant.parentProductId).toBe(parent.id);

      // inexistant
      await expect(
        service.create(
          { storeId, ean: 'P-7', name: 'Var Ghost', priceMinorUnits: 100, parentProductId: '00000000-0000-4000-8000-00000000beef' } as any,
          'emp-1',
        ),
      ).rejects.toThrow(ForbiddenException);

      // autre magasin
      const foreignParent = await service.create(
        { storeId: otherStoreId, ean: 'P-8', name: 'Parent Ailleurs', priceMinorUnits: 100 } as any, 'emp-1',
      );
      await expect(
        service.create(
          { storeId, ean: 'P-9', name: 'Var X-Tenant', priceMinorUnits: 100, parentProductId: foreignParent.id } as any,
          'emp-1',
        ),
      ).rejects.toThrow(ForbiddenException);

      // auto-parent (update)
      await expect(
        service.update(parent.id, { parentProductId: parent.id } as any, 'emp-1', undefined, storeId),
      ).rejects.toThrow(ConflictException);

      // variante-de-variante (1 seul niveau)
      await expect(
        service.create(
          { storeId, ean: 'P-10', name: 'Var de Var', priceMinorUnits: 100, parentProductId: variant.id } as any,
          'emp-1',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });
});
