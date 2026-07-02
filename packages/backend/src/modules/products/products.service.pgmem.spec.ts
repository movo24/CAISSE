import { DataSource, Repository } from 'typeorm';
import { ConflictException } from '@nestjs/common';

import { createPgMemDataSource } from '../../../test/helpers/pgmem';
import { ProductsService } from './products.service';
import { ProductEntity } from '../../database/entities/product.entity';
import { PriceHistoryEntity } from '../../database/entities/price-history.entity';
import { ProductCategoryEntity } from '../../database/entities/product-category.entity';
import { StoreEntity } from '../../database/entities/store.entity';

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
});
