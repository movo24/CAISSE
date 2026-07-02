import { describe, it, expect } from 'vitest';
import { groupProductsForDisplay } from './product-grouping';

// P330 (cycle M) — display grouping rules. Pure, back-office only.

const p = (id: string, over: any = {}) => ({ id, name: over.name ?? id, parentProductId: null, variantLabel: null, ...over });

describe('groupProductsForDisplay', () => {
  it('nests present variants under their parent, sorted by label, keeping the parent position', () => {
    const rows = groupProductsForDisplay([
      p('autre', { name: 'Autre produit' }),
      p('parent', { name: 'Fraise Tagada' }),
      p('v250', { name: 'Fraise Tagada 250g', parentProductId: 'parent', variantLabel: '250 g' }),
      p('v100', { name: 'Fraise Tagada 100g', parentProductId: 'parent', variantLabel: '100 g' }),
    ]);
    expect(rows.map((r) => [r.product.id, r.kind])).toEqual([
      ['autre', 'single'],
      ['parent', 'parent'],
      ['v100', 'variant'], // '100 g' < '250 g'
      ['v250', 'variant'],
    ]);
    expect(rows[1].variantCount).toBe(2);
  });

  it('an orphan variant (parent filtered out) stays visible, flagged — never hidden from the operator', () => {
    const rows = groupProductsForDisplay([
      p('v-seule', { parentProductId: 'parent-absent', variantLabel: 'Citron' }),
      p('simple'),
    ]);
    expect(rows.map((r) => [r.product.id, r.kind])).toEqual([
      ['v-seule', 'orphan-variant'],
      ['simple', 'single'],
    ]);
  });

  it('no variants → every row is single, order untouched', () => {
    const rows = groupProductsForDisplay([p('b'), p('a'), p('c')]);
    expect(rows.map((r) => r.product.id)).toEqual(['b', 'a', 'c']);
    expect(rows.every((r) => r.kind === 'single')).toBe(true);
  });
});
