/** Cycle O — filtres catalogue + tri stable (pur, aucun impact caisse). */
import { describe, it, expect } from 'vitest';
import {
  CATALOG_FILTERS_ALL,
  collectParentIds,
  distinctBrands,
  filterAndSortProducts,
  productType,
  type FilterableProduct,
} from './catalog-filter';

const P = (o: Partial<FilterableProduct> & { id: string; name: string }): FilterableProduct => ({
  ean: `300000000000${o.id}`.slice(-13),
  price: 100,
  stock: 10,
  category: 'bonbons',
  ...o,
});

const parent = P({ id: 'p1', name: 'Cola', brand: 'Wesley' });
const variant1 = P({ id: 'v1', name: 'Cola 33cl', parentProductId: 'p1', supplierId: 's1' });
const variant2 = P({ id: 'v2', name: 'Cola 1L', parentProductId: 'p1', supplierId: 's2' });
const simple = P({ id: 's0', name: 'Réglisse', brand: 'Haribo', supplierId: 's1', category: 'reglisse' });
const orphan = P({ id: 'o1', name: 'Orpheline', parentProductId: 'zz-absent' });
const ALL = [parent, variant1, variant2, simple, orphan];

const f = (over: Partial<typeof CATALOG_FILTERS_ALL>) =>
  filterAndSortProducts(ALL, { ...CATALOG_FILTERS_ALL, ...over }, 'name', 'asc');

describe('type de produit', () => {
  it('classe parent / variante / simple à partir de la liste complète', () => {
    const ids = collectParentIds(ALL);
    expect(productType(parent, ids)).toBe('parent');
    expect(productType(variant1, ids)).toBe('variant');
    expect(productType(simple, ids)).toBe('simple');
    expect(productType(orphan, ids)).toBe('variant'); // orpheline reste une variante
  });
});

describe('filtres', () => {
  it('fournisseur exact, et "none" = sans fournisseur', () => {
    expect(f({ supplierId: 's1' }).map((p) => p.id).sort()).toEqual(['s0', 'v1']);
    expect(f({ supplierId: 'none' }).map((p) => p.id).sort()).toEqual(['o1', 'p1']);
  });

  it('marque exacte, et "none" = sans marque', () => {
    expect(f({ brand: 'Haribo' }).map((p) => p.id)).toEqual(['s0']);
    expect(f({ brand: 'none' }).map((p) => p.id).sort()).toEqual(['o1', 'v1', 'v2']);
  });

  it('type simple/parent/variant', () => {
    expect(f({ type: 'parent' }).map((p) => p.id)).toEqual(['p1']);
    expect(f({ type: 'simple' }).map((p) => p.id)).toEqual(['s0']);
    expect(f({ type: 'variant' }).map((p) => p.id).sort()).toEqual(['o1', 'v1', 'v2']);
  });

  it('les filtres se combinent (ET), recherche incluse', () => {
    expect(f({ type: 'variant', supplierId: 's2' }).map((p) => p.id)).toEqual(['v2']);
    // Tri nom asc : « Cola 1L » avant « Cola 33cl » ('1' < '3').
    expect(f({ search: 'cola', type: 'variant', brand: 'none' }).map((p) => p.id)).toEqual(['v2', 'v1']);
    expect(f({ search: 'introuvable' })).toEqual([]);
  });

  it('le type "parent" est déterminé sur la liste COMPLÈTE, pas la liste filtrée', () => {
    // On filtre sur la catégorie du parent (ses variantes sont exclues) :
    // il doit rester classé "parent" quand même.
    const rows = f({ category: 'bonbons', type: 'parent' });
    expect(rows.map((p) => p.id)).toEqual(['p1']);
  });
});

describe('tri stable', () => {
  const a = P({ id: 'a', name: 'Même prix', price: 500 });
  const b = P({ id: 'b', name: 'Même prix', price: 500 });
  const c = P({ id: 'c', name: 'Autre', price: 500 });

  it('à clé égale, départage déterministe nom puis id — insensible à l’ordre d’entrée', () => {
    const sort = (list: FilterableProduct[]) =>
      filterAndSortProducts(list, CATALOG_FILTERS_ALL, 'price', 'asc').map((p) => p.id);
    expect(sort([a, b, c])).toEqual(['c', 'a', 'b']);
    expect(sort([b, c, a])).toEqual(['c', 'a', 'b']);
    expect(sort([c, b, a])).toEqual(['c', 'a', 'b']);
  });

  it('desc inverse la clé primaire mais garde un ordre total déterministe', () => {
    const one = P({ id: 'x1', name: 'B', price: 100 });
    const two = P({ id: 'x2', name: 'A', price: 200 });
    const rows = filterAndSortProducts([one, two], CATALOG_FILTERS_ALL, 'price', 'desc');
    expect(rows.map((p) => p.id)).toEqual(['x2', 'x1']);
  });
});

describe('distinctBrands', () => {
  it('unique, non vide, trié', () => {
    expect(distinctBrands([...ALL, P({ id: 'z', name: 'Z', brand: ' Wesley ' })])).toEqual([
      'Haribo',
      'Wesley',
    ]);
  });
});
