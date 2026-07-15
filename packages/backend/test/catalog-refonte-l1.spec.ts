/**
 * Catalogue refonte — Lot 1 (no migration).
 * Covers the backend enablement added on top of the existing product model:
 *  - status ↔ isActive alignment (closes audit gap G7);
 *  - SKU uniqueness guard (business rule §7);
 *  - findAll: status filter (default active-only, 'all', specific), categoryId
 *    filter, server-side sort, SKU search;
 *  - hierarchical categories: parentId, productCount, cycle guard, delete guard.
 * Runs on a real-ish schema via pg-mem (no external DB).
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

describe('Catalogue refonte L1 — product enablement (no migration)', () => {
  let ds: DataSource;
  let svc: ProductsService;
  const STORE = uuidv4();
  const EMP = uuidv4();
  let eanSeq = 3610000000000;
  const nextEan = () => String(eanSeq++);

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    await ds
      .getRepository(StoreEntity)
      .save({ id: STORE, name: 'L1', isActive: true, currencyCode: 'EUR' } as any);
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
    );
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  // ── status ↔ isActive alignment (G7) ──────────────────────────────
  describe('status ↔ isActive alignment (G7)', () => {
    it('create with status=draft makes the product not sellable (isActive=false)', async () => {
      const p = await svc.create(
        { ean: nextEan(), name: 'Brouillon', priceMinorUnits: 100, taxRate: 20, storeId: STORE, status: 'draft' } as any,
        EMP,
      );
      expect(p.status).toBe('draft');
      expect(p.isActive).toBe(false);
    });

    it('update isActive=false archives; status=active re-activates', async () => {
      const p = await svc.create(
        { ean: nextEan(), name: 'Bascule', priceMinorUnits: 100, taxRate: 20, storeId: STORE } as any,
        EMP,
      );
      const off = await svc.update(p.id, { isActive: false } as any, EMP, undefined, STORE);
      expect(off.isActive).toBe(false);
      expect(off.status).toBe('archived');
      const on = await svc.update(p.id, { status: 'active' } as any, EMP, undefined, STORE);
      expect(on.status).toBe('active');
      expect(on.isActive).toBe(true);
    });
  });

  // ── SKU uniqueness (§7) ───────────────────────────────────────────
  describe('SKU uniqueness (§7)', () => {
    it('rejects a duplicate SKU on create and on update, but allows the same product to keep its SKU', async () => {
      const a = await svc.create(
        { ean: nextEan(), name: 'SKU-A', priceMinorUnits: 100, taxRate: 20, storeId: STORE, sku: 'REF-001' } as any,
        EMP,
      );
      await expect(
        svc.create(
          { ean: nextEan(), name: 'SKU-dup', priceMinorUnits: 100, taxRate: 20, storeId: STORE, sku: 'REF-001' } as any,
          EMP,
        ),
      ).rejects.toMatchObject({ code: 'PRODUCT_SKU_ALREADY_EXISTS' });

      const b = await svc.create(
        { ean: nextEan(), name: 'SKU-B', priceMinorUnits: 100, taxRate: 20, storeId: STORE, sku: 'REF-002' } as any,
        EMP,
      );
      await expect(
        svc.update(b.id, { sku: 'REF-001' } as any, EMP, undefined, STORE),
      ).rejects.toMatchObject({ code: 'PRODUCT_SKU_ALREADY_EXISTS' });

      // same product re-saving its own SKU is fine
      const same = await svc.update(a.id, { sku: 'REF-001', name: 'SKU-A2' } as any, EMP, undefined, STORE);
      expect(same.sku).toBe('REF-001');
    });
  });

  // ── findAll filters / sort ────────────────────────────────────────
  describe('findAll — status, category, sort, sku search', () => {
    const CAT = uuidv4();
    beforeAll(async () => {
      await ds.getRepository(ProductCategoryEntity).save({ id: CAT, name: 'FiltreCat', storeId: STORE } as any);
      await svc.create({ ean: nextEan(), name: 'Actif cher', priceMinorUnits: 5000, taxRate: 20, storeId: STORE, categoryId: CAT, sku: 'FIND-XYZ' } as any, EMP);
      await svc.create({ ean: nextEan(), name: 'Actif pas cher', priceMinorUnits: 100, taxRate: 20, storeId: STORE, categoryId: CAT } as any, EMP);
      await svc.create({ ean: nextEan(), name: 'Archivé', priceMinorUnits: 200, taxRate: 20, storeId: STORE, status: 'archived' } as any, EMP);
    });

    it('default (no status) returns active only; status=all includes archived; status=archived isolates it', async () => {
      const active = await svc.findAll(STORE, { limit: 100 });
      expect(active.data.every((p) => p.isActive)).toBe(true);
      expect(active.data.some((p) => p.name === 'Archivé')).toBe(false);

      const all = await svc.findAll(STORE, { status: 'all', limit: 100 });
      expect(all.data.some((p) => p.name === 'Archivé')).toBe(true);

      const archived = await svc.findAll(STORE, { status: 'archived', limit: 100 });
      expect(archived.data.every((p) => p.status === 'archived')).toBe(true);
      expect(archived.data.some((p) => p.name === 'Archivé')).toBe(true);
    });

    it('filters by categoryId', async () => {
      const res = await svc.findAll(STORE, { categoryId: CAT, limit: 100 });
      expect(res.data.length).toBeGreaterThanOrEqual(2);
      expect(res.data.every((p) => (p as any).categoryId === CAT)).toBe(true);
    });

    it('sorts by price DESC when asked', async () => {
      const res = await svc.findAll(STORE, { categoryId: CAT, sortBy: 'price', sortDir: 'DESC', limit: 100 });
      const prices = res.data.map((p) => p.priceMinorUnits);
      const sorted = [...prices].sort((a, b) => b - a);
      expect(prices).toEqual(sorted);
    });

    it('search matches SKU as well as name/ean', async () => {
      const res = await svc.findAll(STORE, { search: 'FIND-XYZ', limit: 100 });
      expect(res.data.map((p) => (p as any).sku)).toContain('FIND-XYZ');
    });

    it('an unknown sortBy falls back to name (no injection)', async () => {
      const res = await svc.findAll(STORE, { sortBy: 'price); DROP TABLE products;--', limit: 5 });
      expect(Array.isArray(res.data)).toBe(true);
    });
  });

  // ── hierarchical categories ───────────────────────────────────────
  describe('categories — tree, counts, cycle guard, delete guard', () => {
    it('creates a parent + sub-category and reports parentId + productCount', async () => {
      const parent = await svc.createCategory(STORE, 'Boissons');
      const child = await svc.createCategory(STORE, 'Sans alcool', parent.id);
      expect(child.parentId).toBe(parent.id);

      await svc.create({ ean: nextEan(), name: 'Jus', priceMinorUnits: 200, taxRate: 5.5, storeId: STORE, categoryId: child.id } as any, EMP);
      const tree = await svc.getCategories(STORE);
      const childNode = tree.find((c) => c.id === child.id)!;
      expect(childNode.parentId).toBe(parent.id);
      expect(childNode.productCount).toBe(1);
    });

    it('the same leaf name is allowed under different parents', async () => {
      const a = await svc.createCategory(STORE, 'Rayon A');
      const b = await svc.createCategory(STORE, 'Rayon B');
      const l1 = await svc.createCategory(STORE, 'Promo', a.id);
      const l2 = await svc.createCategory(STORE, 'Promo', b.id);
      expect(l1.id).not.toBe(l2.id);
    });

    it('refuses to move a category under one of its own descendants (cycle)', async () => {
      const root = await svc.createCategory(STORE, 'Univers');
      const mid = await svc.createCategory(STORE, 'Catégorie', root.id);
      await svc.createCategory(STORE, 'Segment', mid.id);
      await expect(
        svc.updateCategory(STORE, root.id, { parentId: mid.id }),
      ).rejects.toMatchObject({ code: 'CATEGORY_CYCLE' });
      // and cannot be its own parent
      await expect(svc.updateCategory(STORE, root.id, { parentId: root.id })).rejects.toThrow();
    });

    it('refuses to delete a category with attached products or sub-categories, allows an empty leaf', async () => {
      const parent = await svc.createCategory(STORE, 'ÀSupprimer');
      const child = await svc.createCategory(STORE, 'Feuille', parent.id);
      await expect(svc.deleteCategory(STORE, parent.id)).rejects.toMatchObject({ code: 'CATEGORY_HAS_CHILDREN' });

      const used = await svc.createCategory(STORE, 'Utilisée');
      await svc.create({ ean: nextEan(), name: 'X', priceMinorUnits: 100, taxRate: 20, storeId: STORE, categoryId: used.id } as any, EMP);
      await expect(svc.deleteCategory(STORE, used.id)).rejects.toMatchObject({ code: 'CATEGORY_IN_USE' });

      const res = await svc.deleteCategory(STORE, child.id);
      expect(res.message).toContain('supprimée');
      const tree = await svc.getCategories(STORE);
      expect(tree.some((c) => c.id === child.id)).toBe(false);
    });
  });

  // ── findAll data-quality filters + catalog stats (L1.4) ───────────
  describe('findAll data-quality filters + getCatalogStats', () => {
    const S = uuidv4();
    let supId = '';
    let catId = '';
    beforeAll(async () => {
      await ds.getRepository(StoreEntity).save({ id: S, name: 'L14', isActive: true, currencyCode: 'EUR' } as any);
      supId = (await svc.getOrCreateSupplier(S, 'Frs A')).id;
      catId = (await svc.createCategory(S, 'Cat A')).id;
      // p1: rupture, sans image/fournisseur/catégorie, TVA 20
      await svc.create({ ean: nextEan(), name: 'P1 vide', priceMinorUnits: 100, taxRate: 20, storeId: S, stockQuantity: 0, stockAlertThreshold: 10 } as any, EMP);
      // p2: sous seuil (3<=10), complet, TVA 5.5
      await svc.create({ ean: nextEan(), name: 'P2 bas', priceMinorUnits: 200, taxRate: 5.5, storeId: S, stockQuantity: 3, stockAlertThreshold: 10, imageUrl: 'http://x/y.png', supplierId: supId, categoryId: catId } as any, EMP);
      // p3: stock ok, complet, TVA 20
      await svc.create({ ean: nextEan(), name: 'P3 ok', priceMinorUnits: 300, taxRate: 20, storeId: S, stockQuantity: 100, stockAlertThreshold: 10, imageUrl: 'http://x/z.png', supplierId: supId, categoryId: catId } as any, EMP);
      // p4: archivé
      await svc.create({ ean: nextEan(), name: 'P4 arch', priceMinorUnits: 400, taxRate: 20, storeId: S, status: 'archived' } as any, EMP);
    });

    it('outOfStock isolates ruptures; belowThreshold includes low stock', async () => {
      const out = await svc.findAll(S, { outOfStock: true, limit: 100 });
      expect(out.data.map((p) => p.name).sort()).toEqual(['P1 vide']);
      const below = await svc.findAll(S, { belowThreshold: true, limit: 100 });
      expect(below.data.map((p) => p.name).sort()).toEqual(['P1 vide', 'P2 bas']);
    });

    it('noImage / noSupplier / noCategory isolate incomplete products', async () => {
      expect((await svc.findAll(S, { noImage: true, limit: 100 })).data.map((p) => p.name)).toEqual(['P1 vide']);
      expect((await svc.findAll(S, { noSupplier: true, limit: 100 })).data.map((p) => p.name)).toEqual(['P1 vide']);
      expect((await svc.findAll(S, { noCategory: true, limit: 100 })).data.map((p) => p.name)).toEqual(['P1 vide']);
    });

    it('filters by exact TVA rate', async () => {
      const r = await svc.findAll(S, { taxRate: 5.5, limit: 100 });
      expect(r.data.map((p) => p.name)).toEqual(['P2 bas']);
    });

    it('getCatalogStats returns real counts', async () => {
      const s = await svc.getCatalogStats(S);
      expect(s.total).toBe(4); // incl. archivé
      expect(s.active).toBe(3);
      expect(s.outOfStock).toBe(1);
      expect(s.belowThreshold).toBe(2);
      expect(s.noImage).toBe(1);
      expect(s.noSupplier).toBe(1);
      expect(s.noCategory).toBe(1);
    });
  });

  // ── Actions de masse (L1.5) ───────────────────────────────────────
  describe('bulkAction', () => {
    const S = uuidv4();
    let ids: string[] = [];
    beforeAll(async () => {
      await ds.getRepository(StoreEntity).save({ id: S, name: 'L15', isActive: true, currencyCode: 'EUR' } as any);
      const a = await svc.create({ ean: nextEan(), name: 'B1', priceMinorUnits: 100, taxRate: 20, storeId: S } as any, EMP);
      const b = await svc.create({ ean: nextEan(), name: 'B2', priceMinorUnits: 200, taxRate: 20, storeId: S } as any, EMP);
      ids = [a.id, b.id];
    });

    it('deactivate then activate flips status + isActive for the whole selection', async () => {
      const off = await svc.bulkAction(S, EMP, 'deactivate', ids, {});
      expect(off.succeeded).toBe(2);
      expect(off.failed).toHaveLength(0);
      for (const id of ids) {
        const p = await svc.findOne(id, S);
        expect(p.isActive).toBe(false);
        expect(p.status).toBe('archived');
      }
      const on = await svc.bulkAction(S, EMP, 'activate', ids, {});
      expect(on.succeeded).toBe(2);
      const p = await svc.findOne(ids[0], S);
      expect(p.isActive).toBe(true);
      expect(p.status).toBe('active');
    });

    it('setTax applies the rate to the selection', async () => {
      await svc.bulkAction(S, EMP, 'setTax', ids, { taxRate: 5.5 });
      const p = await svc.findOne(ids[0], S);
      expect(Number(p.taxRate)).toBe(5.5);
    });

    it('setCategory validates the category exists (rejects an unknown one before any write)', async () => {
      await expect(svc.bulkAction(S, EMP, 'setCategory', ids, { categoryId: uuidv4() })).rejects.toThrow();
      const cat = await svc.createCategory(S, 'BulkCat');
      const r = await svc.bulkAction(S, EMP, 'setCategory', ids, { categoryId: cat.id });
      expect(r.succeeded).toBe(2);
      expect((await svc.findOne(ids[0], S)).categoryId).toBe(cat.id);
    });

    it('setSupplier validates the supplier exists (rejects unknown before write), applies a valid one', async () => {
      await expect(svc.bulkAction(S, EMP, 'setSupplier', ids, { supplierId: uuidv4() })).rejects.toThrow();
      const sup = await svc.getOrCreateSupplier(S, 'BulkFrs');
      const r = await svc.bulkAction(S, EMP, 'setSupplier', ids, { supplierId: sup.id });
      expect(r.succeeded).toBe(2);
      expect((await svc.findOne(ids[0], S)).supplierId).toBe(sup.id);
    });

    it('setTax requires a valid rate; setCategory/setSupplier require their target id', async () => {
      await expect(svc.bulkAction(S, EMP, 'setTax', ids, {})).rejects.toThrow();
      await expect(svc.bulkAction(S, EMP, 'setCategory', ids, {})).rejects.toThrow();
      await expect(svc.bulkAction(S, EMP, 'setSupplier', ids, {})).rejects.toThrow();
    });

    it('audits every successfully modified product (one entry per product)', async () => {
      const auditRepo = ds.getRepository(AuditEntryEntity);
      const before = await auditRepo.count({ where: { action: 'product_bulk_update' } });
      const r = await svc.bulkAction(S, EMP, 'setTax', ids, { taxRate: 10 });
      const after = await auditRepo.count({ where: { action: 'product_bulk_update' } });
      expect(r.succeeded).toBe(2);
      expect(after - before).toBe(2); // un audit par produit modifié
    });

    it('a partial batch reports exact succeeded + failed and still audits only the successes', async () => {
      const auditRepo = ds.getRepository(AuditEntryEntity);
      const before = await auditRepo.count({ where: { action: 'product_bulk_update' } });
      const r = await svc.bulkAction(S, EMP, 'deactivate', [ids[0], uuidv4(), ids[1]], {});
      expect(r.requested).toBe(3);
      expect(r.succeeded).toBe(2);
      expect(r.failed).toHaveLength(1);
      const after = await auditRepo.count({ where: { action: 'product_bulk_update' } });
      expect(after - before).toBe(2); // aucun audit pour l'id introuvable
    });

    it('the bulk endpoint is role-gated to admin/manager (RolesGuard metadata)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { ProductsController } = require('../src/modules/products/products.controller');
      const roles = Reflect.getMetadata('roles', ProductsController.prototype.bulkAction);
      expect(roles).toEqual(['admin', 'manager']);
    });
  });

  // ── Lot 2 — champs additifs de la fiche (migration 1760) ───────────
  describe('Lot 2 — champs additifs persistés (identification / logistique / achat)', () => {
    const S = uuidv4();
    beforeAll(async () => {
      await ds.getRepository(StoreEntity).save({ id: S, name: 'L2', isActive: true, currencyCode: 'EUR' } as any);
    });

    it('create + update persistent short_name/internal_ref/type/logistique/achat', async () => {
      const p = await svc.create(
        {
          ean: nextEan(), name: 'Fiche complète', priceMinorUnits: 500, taxRate: 20, storeId: S,
          shortName: 'Fiche', internalRef: 'INT-001', supplierRef: 'FRS-9', productType: 'pack',
          countryOfOrigin: 'France', leadTimeDays: 7, minOrderQuantity: 24,
          weightGrams: 950, widthMm: 80, heightMm: 300, depthMm: 80, volumeMl: 1000, unitsPerCarton: 6,
        } as any,
        EMP,
      );
      expect(p.shortName).toBe('Fiche');
      expect(p.productType).toBe('pack');
      expect(p.weightGrams).toBe(950);
      expect(p.unitsPerCarton).toBe(6);

      const up = await svc.update(p.id, { weightGrams: 1200, leadTimeDays: 3 } as any, EMP, undefined, S);
      expect(up.weightGrams).toBe(1200);
      expect(up.leadTimeDays).toBe(3);
      // champs non touchés préservés
      expect(up.internalRef).toBe('INT-001');
      expect(up.countryOfOrigin).toBe('France');
    });
  });

  // ── Lot 4 — galerie & documents (URLs, tenant-safe) ────────────────
  describe('Lot 4 — galerie & documents', () => {
    const S = uuidv4();
    let pid = '';
    beforeAll(async () => {
      await ds.getRepository(StoreEntity).save({ id: S, name: 'L4', isActive: true, currencyCode: 'EUR' } as any);
      pid = (await svc.create({ ean: nextEan(), name: 'Média', priceMinorUnits: 100, taxRate: 20, storeId: S } as any, EMP)).id;
    });

    it('add/list/remove media (URLs) en gardant l’ordre', async () => {
      await svc.addMedia(pid, S, 'http://x/1.png');
      await svc.addMedia(pid, S, 'http://x/2.png');
      let list = await svc.listMedia(pid, S);
      expect(list.map((m) => m.url)).toEqual(['http://x/1.png', 'http://x/2.png']);
      await svc.removeMedia(pid, S, list[0].id);
      list = await svc.listMedia(pid, S);
      expect(list.map((m) => m.url)).toEqual(['http://x/2.png']);
      await expect(svc.addMedia(pid, S, '  ')).rejects.toThrow();
    });

    it('add/list/remove documents (nom + URL requis)', async () => {
      await svc.addDocument(pid, S, 'Notice', 'http://x/n.pdf');
      const docs = await svc.listDocuments(pid, S);
      expect(docs).toHaveLength(1);
      expect(docs[0].name).toBe('Notice');
      await expect(svc.addDocument(pid, S, '', 'http://x/x.pdf')).rejects.toThrow();
      await expect(svc.addDocument(pid, S, 'X', '')).rejects.toThrow();
      await svc.removeDocument(pid, S, docs[0].id);
      expect(await svc.listDocuments(pid, S)).toHaveLength(0);
    });

    it('la galerie d’un autre magasin est inaccessible (garde tenant)', async () => {
      await expect(svc.listMedia(pid, uuidv4())).rejects.toThrow();
    });

    it('reorderMedia réordonne selon la liste d’ids (glisser-déposer)', async () => {
      await svc.addMedia(pid, S, 'http://x/r1.png');
      await svc.addMedia(pid, S, 'http://x/r2.png');
      const before = await svc.listMedia(pid, S);
      const reversed = [...before].reverse().map((m) => m.id);
      const after = await svc.reorderMedia(pid, S, reversed);
      expect(after.map((m) => m.id)).toEqual(reversed);
    });
  });

  // ── Lot A — codes-barres multiples ─────────────────────────────────
  describe('Lot A — codes-barres multiples', () => {
    const S = uuidv4();
    let pid = '';
    beforeAll(async () => {
      await ds.getRepository(StoreEntity).save({ id: S, name: 'LA', isActive: true, currencyCode: 'EUR' } as any);
      pid = (await svc.create({ ean: nextEan(), name: 'Multi-EAN', priceMinorUnits: 100, taxRate: 20, storeId: S } as any, EMP)).id;
    });

    it('add/list, refuse un doublon (store, barcode), gère le principal', async () => {
      await svc.addBarcode(pid, S, '5010000000001', 'ean', true);
      await svc.addBarcode(pid, S, '012345678905', 'upc');
      const list = await svc.listBarcodes(pid, S);
      expect(list.map((b) => b.barcode).sort()).toEqual(['012345678905', '5010000000001']);
      expect(list.find((b) => b.barcode === '5010000000001')!.isPrimary).toBe(true);
      // un seul principal
      expect(list.filter((b) => b.isPrimary)).toHaveLength(1);
      // doublon
      await expect(svc.addBarcode(pid, S, '5010000000001', 'ean')).rejects.toMatchObject({ code: 'BARCODE_ALREADY_EXISTS' });
      // vide
      await expect(svc.addBarcode(pid, S, '  ', 'ean')).rejects.toThrow();
    });

    it('setPrimary bascule le principal ; remove supprime', async () => {
      const list = await svc.listBarcodes(pid, S);
      const upc = list.find((b) => b.barcode === '012345678905')!;
      await svc.setPrimaryBarcode(pid, S, upc.id);
      const after = await svc.listBarcodes(pid, S);
      expect(after.find((b) => b.id === upc.id)!.isPrimary).toBe(true);
      expect(after.filter((b) => b.isPrimary)).toHaveLength(1);
      await svc.removeBarcode(pid, S, upc.id);
      expect((await svc.listBarcodes(pid, S)).some((b) => b.id === upc.id)).toBe(false);
    });

    it('garde tenant : un autre magasin ne voit pas les codes', async () => {
      await expect(svc.listBarcodes(pid, uuidv4())).rejects.toThrow();
    });
  });

  // ── Lot B — fournisseurs multiples ─────────────────────────────────
  describe('Lot B — fournisseurs multiples', () => {
    const S = uuidv4();
    let pid = '';
    let sup1 = '';
    let sup2 = '';
    beforeAll(async () => {
      await ds.getRepository(StoreEntity).save({ id: S, name: 'LB', isActive: true, currencyCode: 'EUR' } as any);
      pid = (await svc.create({ ean: nextEan(), name: 'Multi-frs', priceMinorUnits: 100, taxRate: 20, storeId: S } as any, EMP)).id;
      sup1 = (await svc.getOrCreateSupplier(S, 'Frs 1')).id;
      sup2 = (await svc.getOrCreateSupplier(S, 'Frs 2')).id;
    });

    it('attache 2 fournisseurs avec conditions ; principal exclusif ; anti-doublon', async () => {
      await svc.addProductSupplier(pid, S, { supplierId: sup1, isPrimary: true, supplierRef: 'A-1', purchasePriceMinorUnits: 80, leadTimeDays: 5, minOrderQuantity: 12, incoterm: 'DDP' } as any);
      await svc.addProductSupplier(pid, S, { supplierId: sup2, purchasePriceMinorUnits: 75, currencyCode: 'USD' } as any);
      const list = await svc.listProductSuppliers(pid, S);
      expect(list).toHaveLength(2);
      expect(list.filter((r) => r.isPrimary)).toHaveLength(1);
      expect(list.find((r) => r.supplierId === sup1)!.supplierRef).toBe('A-1');
      expect(list.find((r) => r.supplierId === sup2)!.currencyCode).toBe('USD');
      await expect(svc.addProductSupplier(pid, S, { supplierId: sup1 } as any)).rejects.toMatchObject({ code: 'PRODUCT_SUPPLIER_EXISTS' });
    });

    it('rejette un fournisseur hors magasin ; update bascule le principal', async () => {
      await expect(svc.addProductSupplier(pid, S, { supplierId: uuidv4() } as any)).rejects.toThrow();
      const list = await svc.listProductSuppliers(pid, S);
      const second = list.find((r) => r.supplierId === sup2)!;
      await svc.updateProductSupplier(pid, S, second.id, { isPrimary: true, leadTimeDays: 3 } as any);
      const after = await svc.listProductSuppliers(pid, S);
      expect(after.find((r) => r.id === second.id)!.isPrimary).toBe(true);
      expect(after.find((r) => r.id === second.id)!.leadTimeDays).toBe(3);
      expect(after.filter((r) => r.isPrimary)).toHaveLength(1);
      await svc.removeProductSupplier(pid, S, second.id);
      expect((await svc.listProductSuppliers(pid, S)).some((r) => r.id === second.id)).toBe(false);
    });

    it('garde tenant', async () => {
      await expect(svc.listProductSuppliers(pid, uuidv4())).rejects.toThrow();
    });
  });

  // ── Lot C — générateur de variantes par attributs ──────────────────
  describe('Lot C — générateur de variantes', () => {
    const S = uuidv4();
    let pid = '';
    beforeAll(async () => {
      await ds.getRepository(StoreEntity).save({ id: S, name: 'LC', isActive: true, currencyCode: 'EUR' } as any);
      pid = (await svc.create({ ean: nextEan(), name: 'T-Shirt', priceMinorUnits: 1500, taxRate: 20, storeId: S } as any, EMP)).id;
    });

    it('produit cartésien Taille×Couleur = 6 variantes, EAN uniques, idempotent', async () => {
      const res = await svc.generateVariants(pid, S, [
        { name: 'Taille', values: ['S', 'M', 'L'] },
        { name: 'Couleur', values: ['Noir', 'Blanc'] },
      ], EMP);
      expect(res.created).toBe(6);
      const list = await svc.listVariants(pid, S);
      expect(list).toHaveLength(6);
      expect(list.map((v) => v.variantName).sort()).toEqual(
        ['L / Blanc', 'L / Noir', 'M / Blanc', 'M / Noir', 'S / Blanc', 'S / Noir'].sort(),
      );
      // EAN uniques et internes
      const eans = list.map((v) => v.ean);
      expect(new Set(eans).size).toBe(6);
      expect(eans.every((e) => e.startsWith('290'))).toBe(true);
      // ré-exécution : tout est skippé (idempotent)
      const again = await svc.generateVariants(pid, S, [
        { name: 'Taille', values: ['S', 'M', 'L'] },
        { name: 'Couleur', values: ['Noir', 'Blanc'] },
      ], EMP);
      expect(again.created).toBe(0);
      expect(again.skipped).toHaveLength(6);
    });

    it('refuse sans attribut et refuse une variante de variante', async () => {
      await expect(svc.generateVariants(pid, S, [], EMP)).rejects.toThrow();
      const variant = (await svc.listVariants(pid, S))[0];
      await expect(svc.generateVariants(variant.id, S, [{ name: 'X', values: ['a'] }], EMP)).rejects.toThrow();
    });
  });

  // ── Lot D — journal des modifications de la fiche ──────────────────
  describe('Lot D — journal des modifications', () => {
    const S = uuidv4();
    let pid = '';
    beforeAll(async () => {
      await ds.getRepository(StoreEntity).save({ id: S, name: 'LD', isActive: true, currencyCode: 'EUR' } as any);
      pid = (await svc.create({ ean: nextEan(), name: 'Suivi', priceMinorUnits: 1000, costMinorUnits: 600, taxRate: 20, storeId: S } as any, EMP)).id;
    });

    it('trace prix de vente, prix d’achat, TVA et nom lors d’un update', async () => {
      await svc.update(pid, { priceMinorUnits: 1200, costMinorUnits: 700, taxRate: 5.5, name: 'Suivi v2' } as any, EMP, 'hausse', S, 'backoffice', 'admin');
      const log = await svc.getChangeLog(pid, S);
      const byField = new Map(log.map((r) => [r.field, r]));
      expect(byField.get('priceMinorUnits')).toMatchObject({ oldValue: '1000', newValue: '1200' });
      expect(byField.get('costMinorUnits')).toMatchObject({ oldValue: '600', newValue: '700' });
      expect(byField.get('taxRate')?.oldValue).toBe('20');
      expect(byField.get('name')).toMatchObject({ oldValue: 'Suivi', newValue: 'Suivi v2', changedByRole: 'admin' });
    });

    it('ne trace pas un champ inchangé ; garde tenant', async () => {
      const before = (await svc.getChangeLog(pid, S)).length;
      await svc.update(pid, { name: 'Suivi v2' } as any, EMP, undefined, S); // identique → rien
      expect((await svc.getChangeLog(pid, S)).length).toBe(before);
      await expect(svc.getChangeLog(pid, uuidv4())).rejects.toThrow();
    });
  });

  // ── Lot E — produits liés + saisonnalité ───────────────────────────
  describe('Lot E — produits liés & saisonnalité', () => {
    const S = uuidv4();
    let a = '';
    let b = '';
    beforeAll(async () => {
      await ds.getRepository(StoreEntity).save({ id: S, name: 'LE', isActive: true, currencyCode: 'EUR' } as any);
      a = (await svc.create({ ean: nextEan(), name: 'Café', priceMinorUnits: 500, taxRate: 20, storeId: S } as any, EMP)).id;
      b = (await svc.create({ ean: nextEan(), name: 'Sucre', priceMinorUnits: 200, taxRate: 20, storeId: S } as any, EMP)).id;
    });

    it('lie 2 produits, refuse self-link, refuse doublon, remove', async () => {
      await svc.addLink(a, S, b, 'complementary');
      const list = await svc.listLinks(a, S);
      expect(list).toHaveLength(1);
      expect(list[0].linkedProductId).toBe(b);
      expect((list[0] as any).linkedProduct?.name).toBe('Sucre');
      await expect(svc.addLink(a, S, a)).rejects.toThrow(); // self
      await expect(svc.addLink(a, S, b, 'complementary')).rejects.toMatchObject({ code: 'PRODUCT_LINK_EXISTS' });
      // un autre type est permis
      await svc.addLink(a, S, b, 'substitute');
      expect(await svc.listLinks(a, S)).toHaveLength(2);
      await svc.removeLink(a, S, list[0].id);
      expect(await svc.listLinks(a, S)).toHaveLength(1);
    });

    it('saisonnalité persistée + tracée dans le change-log', async () => {
      await svc.update(a, { isSeasonal: true, seasonStartMonth: 11, seasonEndMonth: 1 } as any, EMP, undefined, S);
      const p = await svc.findOne(a, S);
      expect(p.isSeasonal).toBe(true);
      expect(p.seasonStartMonth).toBe(11);
      const log = await svc.getChangeLog(a, S);
      expect(log.some((r) => r.field === 'isSeasonal')).toBe(true);
    });

    it('garde tenant sur les liens', async () => {
      await expect(svc.listLinks(a, uuidv4())).rejects.toThrow();
    });
  });

  // ── Lot F — duplication complète ───────────────────────────────────
  describe('Lot F — duplication complète', () => {
    const S = uuidv4();
    let src = '';
    let other = '';
    beforeAll(async () => {
      await ds.getRepository(StoreEntity).save({ id: S, name: 'LF', isActive: true, currencyCode: 'EUR' } as any);
      src = (await svc.create({ ean: nextEan(), name: 'À dupliquer', priceMinorUnits: 900, taxRate: 20, storeId: S, sku: 'SRC-1', weightGrams: 300 } as any, EMP)).id;
      other = (await svc.create({ ean: nextEan(), name: 'Composant', priceMinorUnits: 100, taxRate: 20, storeId: S } as any, EMP)).id;
      await svc.addComponent(src, S, { componentProductId: other, quantityPerParent: 2 } as any);
      await svc.addMedia(src, S, 'http://x/a.png');
      const sup = await svc.getOrCreateSupplier(S, 'FrsDup');
      await svc.addProductSupplier(src, S, { supplierId: sup.id, purchasePriceMinorUnits: 400 } as any);
      await svc.addLink(src, S, other, 'complementary');
    });

    it('clone la fiche (EAN interne neuf, SKU vidé, brouillon, stock 0) + composants/media/fournisseurs/liens', async () => {
      const clone = await svc.duplicateProduct(src, S, EMP);
      expect(clone.id).not.toBe(src);
      expect(clone.name).toBe('À dupliquer (copie)');
      expect(clone.ean).not.toBe((await svc.findOne(src, S)).ean);
      expect(clone.ean.startsWith('290')).toBe(true);
      expect(clone.sku).toBeFalsy();
      expect(clone.status).toBe('draft');
      expect(clone.isActive).toBe(false);
      expect(clone.stockQuantity).toBe(0);
      expect(clone.weightGrams).toBe(300); // champ additif copié
      expect(await svc.listComponents(clone.id, S)).toHaveLength(1);
      expect(await svc.listMedia(clone.id, S)).toHaveLength(1);
      expect(await svc.listProductSuppliers(clone.id, S)).toHaveLength(1);
      expect(await svc.listLinks(clone.id, S)).toHaveLength(1);
    });

    it('refuse de dupliquer une variante et garde tenant', async () => {
      const parent = (await svc.create({ ean: nextEan(), name: 'Parent', priceMinorUnits: 100, taxRate: 20, storeId: S } as any, EMP)).id;
      const variant = await svc.createVariant(parent, S, { ean: nextEan(), variantName: 'V', priceMinorUnits: 100 }, EMP);
      await expect(svc.duplicateProduct(variant.id, S, EMP)).rejects.toThrow();
      await expect(svc.duplicateProduct(src, uuidv4(), EMP)).rejects.toThrow();
    });
  });
});
