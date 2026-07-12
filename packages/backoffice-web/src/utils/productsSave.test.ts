import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * R1 — garde source sur ProductsPage : l'écran principal doit passer par les
 * builders alignés DTO et ne JAMAIS renvoyer le payload cassé d'origine.
 */
const src = readFileSync(join(__dirname, '..', 'pages', 'ProductsPage.tsx'), 'utf8');

describe('ProductsPage — sauvegarde produit (source)', () => {
  it('utilise les builders alignés sur les DTO backend', () => {
    expect(src).toMatch(/buildCreatePayload\(form\)/);
    expect(src).toMatch(/buildUpdatePayload\(form/);
  });

  it("ne construit plus le payload cassé { price, stock, category, storeId }", () => {
    // L'ancien objet littéral envoyait des champs hors DTO. Il ne doit plus exister.
    expect(src).not.toMatch(/price:\s*newPrice,\s*\n\s*stock:/);
    expect(src).not.toMatch(/category:\s*form\.category,\s*\n\s*storeId,/);
  });

  it('valide le formulaire côté client avant envoi', () => {
    expect(src).toMatch(/validateProductForm\(form, editingId !== null\)/);
  });

  it("rend le champ EAN non modifiable en édition (immuable côté DTO)", () => {
    expect(src).toMatch(/disabled=\{editingId !== null\}/);
  });

  it('expose les champs coût, TVA et description (indispensables à la marge)', () => {
    expect(src).toMatch(/form\.cost/);
    expect(src).toMatch(/form\.taxRate/);
    expect(src).toMatch(/form\.description/);
  });
});
