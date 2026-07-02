/**
 * P330 (cycle M) — regroupement visuel des variantes sous leur parent
 * (option A : la variante EST un produit qui pointe `parentProductId`).
 * PUR et read-only : aucun impact caisse — scan EAN, décrément, hash-chain et
 * promos ne passent jamais par ici (affichage back-office uniquement).
 *
 * Règles :
 *  - un parent (ou produit simple) garde sa position dans l'ordre d'entrée
 *    (le tri/filtre amont reste maître) ;
 *  - ses variantes PRÉSENTES dans la liste viennent juste dessous, triées par
 *    libellé de variante puis nom ;
 *  - une variante ORPHELINE (parent absent de la liste — filtré ou supprimé)
 *    reste affichée à sa place, marquée `orphan` (jamais masquée : on ne cache
 *    pas de stock à l'opérateur).
 */

export interface GroupableProduct {
  id: string;
  parentProductId?: string | null;
  variantLabel?: string | null;
  name: string;
}

export interface DisplayRow<T extends GroupableProduct> {
  product: T;
  kind: 'single' | 'parent' | 'variant' | 'orphan-variant';
  /** For parents: how many of their variants are in the current list. */
  variantCount: number;
}

export function groupProductsForDisplay<T extends GroupableProduct>(products: T[]): DisplayRow<T>[] {
  const ids = new Set(products.map((p) => p.id));
  const variantsByParent = new Map<string, T[]>();
  for (const p of products) {
    if (p.parentProductId && ids.has(p.parentProductId)) {
      variantsByParent.set(p.parentProductId, [...(variantsByParent.get(p.parentProductId) ?? []), p]);
    }
  }
  const sortVariants = (a: T, b: T) =>
    (a.variantLabel ?? '').localeCompare(b.variantLabel ?? '') || a.name.localeCompare(b.name);

  const rows: DisplayRow<T>[] = [];
  for (const p of products) {
    if (p.parentProductId && ids.has(p.parentProductId)) continue; // rendue sous son parent
    const variants = (variantsByParent.get(p.id) ?? []).sort(sortVariants);
    if (p.parentProductId && !ids.has(p.parentProductId)) {
      rows.push({ product: p, kind: 'orphan-variant', variantCount: 0 });
      continue;
    }
    rows.push({ product: p, kind: variants.length > 0 ? 'parent' : 'single', variantCount: variants.length });
    for (const v of variants) rows.push({ product: v, kind: 'variant', variantCount: 0 });
  }
  return rows;
}
