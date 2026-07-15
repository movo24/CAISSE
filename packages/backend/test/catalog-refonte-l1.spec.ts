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
});
