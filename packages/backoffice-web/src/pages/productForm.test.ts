import { describe, it, expect } from 'vitest';
import {
  validateProductForm,
  buildCreatePayload,
  buildUpdatePayload,
  type ProductFormValues,
} from './productForm';

/**
 * R1 — contrat de payload produit backoffice ↔ DTO backend.
 * Le bug corrigé : ProductsPage envoyait { price, stock, category, storeId }
 * (et `ean` en modification), rejeté 400 par `forbidNonWhitelisted`. Ces tests
 * verrouillent l'alignement exact avec CreateProductDto / UpdateProductDto.
 */

const base: ProductFormValues = {
  name: 'Coca 33cl',
  ean: '3760001000001',
  price: '2.90',
  stock: '50',
  category: 'boissons',
  description: 'Canette',
  cost: '1.20',
  taxRate: '5.5',
};

describe('buildCreatePayload', () => {
  it('mappe vers les noms de champs du DTO et convertit les euros en centimes', () => {
    expect(buildCreatePayload(base)).toEqual({
      ean: '3760001000001',
      name: 'Coca 33cl',
      priceMinorUnits: 290,
      stockQuantity: 50,
      categoryId: 'boissons',
      description: 'Canette',
      costMinorUnits: 120,
      taxRate: 5.5,
    });
  });

  it("n'émet JAMAIS storeId, price, stock ni category (champs hors DTO → 400)", () => {
    const p = buildCreatePayload(base) as unknown as Record<string, unknown>;
    expect(p).not.toHaveProperty('storeId');
    expect(p).not.toHaveProperty('price');
    expect(p).not.toHaveProperty('stock');
    expect(p).not.toHaveProperty('category');
  });

  it('omet les champs optionnels vides plutôt que d\'envoyer des clés vides', () => {
    const p = buildCreatePayload({ ...base, category: '', description: '  ', cost: '', taxRate: '' });
    expect(p).toEqual({ ean: '3760001000001', name: 'Coca 33cl', priceMinorUnits: 290, stockQuantity: 50 });
  });

  it('stock vide → 0', () => {
    expect(buildCreatePayload({ ...base, stock: '' }).stockQuantity).toBe(0);
  });

  it('arrondit les centimes correctement (pas de dérive flottante)', () => {
    expect(buildCreatePayload({ ...base, price: '19.99', cost: '0.07' })).toMatchObject({
      priceMinorUnits: 1999,
      costMinorUnits: 7,
    });
  });
});

describe('buildUpdatePayload', () => {
  it('NE contient JAMAIS `ean` (absent de UpdateProductDto → 400) ni storeId', () => {
    const p = buildUpdatePayload(base) as unknown as Record<string, unknown>;
    expect(p).not.toHaveProperty('ean');
    expect(p).not.toHaveProperty('storeId');
    expect(p).not.toHaveProperty('price');
    expect(p).not.toHaveProperty('stock');
    expect(p).not.toHaveProperty('category');
  });

  it('mappe les champs modifiables vers le DTO', () => {
    expect(buildUpdatePayload(base)).toEqual({
      name: 'Coca 33cl',
      priceMinorUnits: 290,
      stockQuantity: 50,
      categoryId: 'boissons',
      description: 'Canette',
      costMinorUnits: 120,
      taxRate: 5.5,
    });
  });

  it('ajoute `reason` seulement s\'il est fourni (trace du changement de prix)', () => {
    expect(buildUpdatePayload(base)).not.toHaveProperty('reason');
    expect(buildUpdatePayload(base, 'Modification via backoffice').reason).toBe('Modification via backoffice');
  });
});

describe('validateProductForm', () => {
  it('accepte un formulaire complet (création et modification)', () => {
    expect(validateProductForm(base, false)).toBeNull();
    expect(validateProductForm(base, true)).toBeNull();
  });

  it('refuse un nom vide', () => {
    expect(validateProductForm({ ...base, name: '   ' }, false)).toMatch(/nom/i);
  });

  it('exige un EAN à la création, mais pas en modification', () => {
    expect(validateProductForm({ ...base, ean: '' }, false)).toMatch(/EAN/i);
    expect(validateProductForm({ ...base, ean: '' }, true)).toBeNull();
  });

  it('refuse un prix vide, négatif ou non numérique', () => {
    expect(validateProductForm({ ...base, price: '' }, false)).toMatch(/prix/i);
    expect(validateProductForm({ ...base, price: '-1' }, false)).toMatch(/prix/i);
    expect(validateProductForm({ ...base, price: 'abc' }, false)).toMatch(/prix/i);
    expect(validateProductForm({ ...base, price: '0' }, false)).toBeNull(); // prix 0 autorisé (DTO Min 0)
  });

  it('refuse un stock / coût / TVA négatifs', () => {
    expect(validateProductForm({ ...base, stock: '-2' }, false)).toMatch(/stock/i);
    expect(validateProductForm({ ...base, cost: '-1' }, false)).toMatch(/achat/i);
    expect(validateProductForm({ ...base, taxRate: '-5' }, false)).toMatch(/TVA/i);
  });
});
