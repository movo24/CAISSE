import { DataSource, Repository } from 'typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';

import { createPgMemDataSource } from '../../../test/helpers/pgmem';
import { SuppliersService } from './suppliers.service';
import { SupplierEntity } from '../../database/entities/supplier.entity';
import { StoreEntity } from '../../database/entities/store.entity';
import { ProductEntity } from '../../database/entities/product.entity';

// P327 (cycle K — variantes option A) — suppliers CRUD + variant rules on real SQL.

describe('SuppliersService + variant fields (pg-mem)', () => {
  let dataSource: DataSource;
  let repo: Repository<SupplierEntity>;
  let productRepo: Repository<ProductEntity>;
  let service: SuppliersService;
  let storeId: string;
  let otherStoreId: string;
  const auditLog = jest.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    const built = createPgMemDataSource();
    dataSource = built.dataSource;
    await dataSource.initialize();
    repo = dataSource.getRepository(SupplierEntity);
    productRepo = dataSource.getRepository(ProductEntity);
    service = new SuppliersService(repo, { log: auditLog } as any);
    const stores = dataSource.getRepository(StoreEntity);
    storeId = (await stores.save(stores.create({ name: 'Wesley' }))).id;
    otherStoreId = (await stores.save(stores.create({ name: 'Other' }))).id;
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('creates, refuses same-store duplicates (409), allows the SAME name in another store', async () => {
    const h = await service.create(storeId, { name: ' Haribo ', contact: '01 23 45 67 89' });
    expect(h.name).toBe('Haribo'); // trimmed
    await expect(service.create(storeId, { name: 'Haribo' })).rejects.toThrow(ConflictException);
    const other = await service.create(otherStoreId, { name: 'Haribo' });
    expect(other.id).not.toBe(h.id);
  });

  it('list is tenant-scoped, active-only by default; deactivate is a SOFT delete (reference preserved)', async () => {
    const dead = await service.create(storeId, { name: 'Fournisseur sortant' });
    // un produit référence ce fournisseur
    const p = await productRepo.save(
      productRepo.create({
        ean: 'E-SUP', name: 'Guimauve fournisseur', priceMinorUnits: 100, storeId,
        supplierId: dead.id, brand: 'MaisonWesley',
      } as Partial<ProductEntity>),
    );
    await service.deactivate(dead.id, storeId);

    const active = await service.list(storeId);
    expect(active.some((s) => s.id === dead.id)).toBe(false);
    const all = await service.list(storeId, true);
    expect(all.some((s) => s.id === dead.id)).toBe(true);
    // la référence produit survit (historique intact)
    expect((await productRepo.findOneBy({ id: p.id }))!.supplierId).toBe(dead.id);
    // cross-tenant : introuvable depuis l'autre magasin
    await expect(service.findOne(dead.id, otherStoreId)).rejects.toThrow(NotFoundException);
  });

  it('VARIANTES : deux déclinaisons du même parent coexistent (EAN/prix/stock propres), même EAN refusé par l’unique existant', async () => {
    const parent = await productRepo.save(
      productRepo.create({ ean: 'E-PARENT', name: 'Fraise Tagada', priceMinorUnits: 200, storeId, isActive: false } as Partial<ProductEntity>),
    );
    const v100 = await productRepo.save(
      productRepo.create({
        ean: 'E-V100', name: 'Fraise Tagada 100g', priceMinorUnits: 200, stockQuantity: 30,
        storeId, parentProductId: parent.id, variantLabel: '100 g', brand: 'Haribo',
      } as Partial<ProductEntity>),
    );
    await productRepo.save(
      productRepo.create({
        ean: 'E-V250', name: 'Fraise Tagada 250g', priceMinorUnits: 450, stockQuantity: 12,
        storeId, parentProductId: parent.id, variantLabel: '250 g', brand: 'Haribo',
      } as Partial<ProductEntity>),
    );
    // regroupement : les 2 variantes du parent
    const siblings = await productRepo.findBy({ storeId, parentProductId: parent.id } as any);
    expect(siblings.map((s) => s.variantLabel).sort()).toEqual(['100 g', '250 g']);
    // doublons interdits : même EAN dans le même magasin → refus DB (unique existant, PAR variante)
    await expect(
      productRepo.save(
        productRepo.create({ ean: 'E-V100', name: 'Copie', priceMinorUnits: 1, storeId, parentProductId: parent.id } as Partial<ProductEntity>),
      ),
    ).rejects.toThrow();
    expect(v100.parentProductId).toBe(parent.id);
  });

  // ── Cycle Q — audit trail des mutations fournisseur ───────────────────────

  it('Cycle Q : create/update/deactivate écrivent une entrée d’audit (append-only), avec before/after sur update', async () => {
    auditLog.mockClear();
    const s = await service.create(storeId, { name: 'Audité SARL' }, 'emp-42');
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId, employeeId: 'emp-42', action: 'supplier_created',
        entityType: 'supplier', entityId: s.id,
      }),
    );

    auditLog.mockClear();
    await service.update(s.id, storeId, { contact: 'contact@audite.fr' }, 'emp-42');
    const updCall = auditLog.mock.calls[0][0];
    expect(updCall.action).toBe('supplier_updated');
    expect(updCall.details.before.contact).toBeNull();
    expect(updCall.details.after.contact).toBe('contact@audite.fr');

    auditLog.mockClear();
    await service.deactivate(s.id, storeId, 'emp-42');
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'supplier_deactivated', entityId: s.id }),
    );
  });

  it('Cycle Q : un échec d’audit ne fait PAS échouer la mutation métier', async () => {
    auditLog.mockRejectedValueOnce(new Error('audit down'));
    const s = await service.create(storeId, { name: 'Résilient & Fils' }, 'emp-42');
    expect(s.id).toBeTruthy(); // la création a survécu
    auditLog.mockResolvedValue(undefined);
  });
});
