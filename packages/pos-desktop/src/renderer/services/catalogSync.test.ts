import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  fetchFullCatalogue,
  saveCatalogueCache,
  loadCatalogueCache,
  clearCatalogueCache,
  CATALOG_PAGE_LIMIT,
  CATALOG_MAX_PAGES,
} from './catalogSync';

const product = (i: number) =>
  ({ id: `p${i}`, ean: String(1000000000000 + i), name: `Produit ${i}` }) as any;

const paged = (all: any[]) =>
  vi.fn(async ({ page, limit }: { page: number; limit: number }) => ({
    data: { data: all.slice((page - 1) * limit, page * limit), total: all.length },
  }));

describe('fetchFullCatalogue — le catalogue COMPLET, pas la première page', () => {
  it('une seule page quand total ≤ limit', async () => {
    const all = Array.from({ length: 42 }, (_, i) => product(i));
    const list = paged(all);
    const out = await fetchFullCatalogue(list);
    expect(out.products).toHaveLength(42);
    expect(out.total).toBe(42);
    expect(out.complete).toBe(true);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('boucle sur toutes les pages (450 produits → 3 pages de 200)', async () => {
    const all = Array.from({ length: 450 }, (_, i) => product(i));
    const list = paged(all);
    const out = await fetchFullCatalogue(list);
    expect(out.products).toHaveLength(450);
    expect(out.complete).toBe(true);
    expect(list).toHaveBeenCalledTimes(3);
    // Le produit « au fond de l'alphabet » (hors première page) est bien là.
    expect(out.products.map((p) => p.id)).toContain('p449');
  });

  it('réponse legacy en tableau nu → une page, pas de boucle', async () => {
    const list = vi.fn(async () => ({ data: [product(1), product(2)] }));
    const out = await fetchFullCatalogue(list);
    expect(out.products).toHaveLength(2);
    expect(out.complete).toBe(true);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('garde-fou MAX_PAGES : tronque en le SIGNALANT (complete=false)', async () => {
    const huge = Array.from({ length: (CATALOG_MAX_PAGES + 2) * CATALOG_PAGE_LIMIT }, (_, i) =>
      product(i),
    );
    const list = paged(huge);
    const out = await fetchFullCatalogue(list);
    expect(out.products).toHaveLength(CATALOG_MAX_PAGES * CATALOG_PAGE_LIMIT);
    expect(out.complete).toBe(false);
  });

  it('échec de la première page → lève (l\'appelant garde son cache)', async () => {
    const list = vi.fn(async () => {
      throw new Error('network');
    });
    await expect(fetchFullCatalogue(list)).rejects.toThrow('network');
  });
});

describe('cache catalogue persistant', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('save puis load restitue produits + horodatage', () => {
    const now = new Date('2026-07-22T12:00:00.000Z');
    saveCatalogueCache([product(1), product(2)], now);
    const cache = loadCatalogueCache();
    expect(cache.products).toHaveLength(2);
    expect(cache.at).toBe('2026-07-22T12:00:00.000Z');
  });

  it('cache absent ou corrompu → vide, jamais de crash', () => {
    expect(loadCatalogueCache()).toEqual({ at: null, products: [] });
    localStorage.setItem('pos_catalogue_cache_v1', '{corrompu');
    expect(loadCatalogueCache()).toEqual({ at: null, products: [] });
  });

  it('clear vide le cache', () => {
    saveCatalogueCache([product(1)]);
    clearCatalogueCache();
    expect(loadCatalogueCache().products).toHaveLength(0);
  });
});
