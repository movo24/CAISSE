/**
 * Cycle O — filtres catalogue (fournisseur / marque / type) + tri stable.
 * PUR et read-only : affichage back-office uniquement, aucun impact caisse.
 *
 * Sémantique des filtres :
 *  - supplierId : 'all' | 'none' (sans fournisseur) | <id>
 *  - brand      : 'all' | 'none' (sans marque)      | <valeur exacte>
 *  - type       : 'all' | 'simple' | 'parent' | 'variant'
 *      · variant = pointe un parentProductId
 *      · parent  = référencé comme parent par AU MOINS un produit de la liste
 *                  complète (pas seulement la liste filtrée)
 *      · simple  = ni l'un ni l'autre
 *
 * Tri stable : à clé égale, départage déterministe par nom puis id — le même
 * jeu de données produit toujours le même ordre, quel que soit l'ordre d'entrée.
 */

export interface FilterableProduct {
  id: string;
  ean: string;
  name: string;
  price: number;
  stock: number;
  category: string;
  brand?: string | null;
  supplierId?: string | null;
  parentProductId?: string | null;
}

export type CatalogSortKey = 'name' | 'price' | 'stock' | 'category';
export type CatalogSortDir = 'asc' | 'desc';

export interface CatalogFilters {
  search: string;
  category: string; // 'all' | valeur
  supplierId: string; // 'all' | 'none' | id
  brand: string; // 'all' | 'none' | valeur
  type: 'all' | 'simple' | 'parent' | 'variant';
}

export const CATALOG_FILTERS_ALL: CatalogFilters = {
  search: '',
  category: 'all',
  supplierId: 'all',
  brand: 'all',
  type: 'all',
};

export function productType<T extends FilterableProduct>(
  p: T,
  parentIds: ReadonlySet<string>,
): 'simple' | 'parent' | 'variant' {
  if (p.parentProductId) return 'variant';
  if (parentIds.has(p.id)) return 'parent';
  return 'simple';
}

/** Ids référencés comme parent par au moins un produit de la liste COMPLÈTE. */
export function collectParentIds<T extends FilterableProduct>(all: T[]): Set<string> {
  const out = new Set<string>();
  for (const p of all) if (p.parentProductId) out.add(p.parentProductId);
  return out;
}

/** Marques distinctes non vides, triées — pour alimenter le <select>. */
export function distinctBrands<T extends FilterableProduct>(all: T[]): string[] {
  return [...new Set(all.map((p) => (p.brand ?? '').trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

export function filterAndSortProducts<T extends FilterableProduct>(
  all: T[],
  filters: CatalogFilters,
  sortKey: CatalogSortKey,
  sortDir: CatalogSortDir,
): T[] {
  const parentIds = collectParentIds(all);
  const q = filters.search.trim().toLowerCase();

  const kept = all.filter((p) => {
    if (q && !(p.name.toLowerCase().includes(q) || p.ean.includes(q))) return false;
    if (filters.category !== 'all' && p.category !== filters.category) return false;

    if (filters.supplierId === 'none') {
      if (p.supplierId) return false;
    } else if (filters.supplierId !== 'all' && p.supplierId !== filters.supplierId) {
      return false;
    }

    const brand = (p.brand ?? '').trim();
    if (filters.brand === 'none') {
      if (brand) return false;
    } else if (filters.brand !== 'all' && brand !== filters.brand) {
      return false;
    }

    if (filters.type !== 'all' && productType(p, parentIds) !== filters.type) return false;
    return true;
  });

  const dir = sortDir === 'asc' ? 1 : -1;
  const key = (p: T): string | number =>
    sortKey === 'price' ? p.price : sortKey === 'stock' ? p.stock : sortKey === 'category' ? p.category : p.name;

  return [...kept].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    const primary = typeof ka === 'number' ? ka - (kb as number) : ka.localeCompare(kb as string);
    if (primary !== 0) return primary * dir;
    // Départage déterministe (indépendant de l'ordre d'entrée) :
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
}
