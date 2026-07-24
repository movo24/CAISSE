import { describe, it, expect } from 'vitest';
import {
  validateProductForm,
  buildCreatePayload,
  buildUpdatePayload,
  confirmsPosAvailability,
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

/* ── Bug terrain 2026-07-15 : « Erreur de validation » générique + virgule FR ── */
import { parseFr, extractFieldErrors, apiErrorMessage } from './productForm';

describe('parseFr — nombres français', () => {
  it('accepte la virgule décimale (12,50 → 12.5, plus jamais 12)', () => {
    expect(parseFr('12,50')).toBe(12.5);
    expect(parseFr('5,5')).toBe(5.5);
    expect(parseFr('1 250,99')).toBe(1250.99);
    expect(parseFr('12.50')).toBe(12.5);
  });
  it('buildCreatePayload convertit 12,50 € en 1250 centimes', () => {
    const p = buildCreatePayload({ name: 'X', ean: '1', price: '12,50', stock: '', category: '', description: '', cost: '5,25', taxRate: '5,5' });
    expect(p.priceMinorUnits).toBe(1250);
    expect(p.costMinorUnits).toBe(525);
    expect(p.taxRate).toBe(5.5);
  });
});

describe('extractFieldErrors — plus de générique muet', () => {
  it('mappe les details class-validator sur des champs libellés', () => {
    const errs = extractFieldErrors({
      code: 'VALIDATION_ERROR', message: 'Erreur de validation.',
      details: ['property price should not exist', 'priceMinorUnits must be an integer number', 'taxRate must not be less than 0'],
    });
    expect(errs).toHaveLength(3);
    expect(errs[0].field).toBe('price');
    expect(errs[0].message).toMatch(/obsolète/);
    expect(errs[1].message).toBe('Prix de vente : nombre invalide.');
    expect(errs[2].message).toBe('TVA : doit être positif ou nul.');
  });
  it("apiErrorMessage n'affiche jamais le générique quand des details existent", () => {
    const msg = apiErrorMessage({ response: { data: { message: 'Erreur de validation.', details: ['name should not be empty'] } } });
    expect(msg).toBe('Nom : obligatoire.');
  });
  it('apiErrorMessage relaie les messages métier précis (ex. EAN déjà utilisé)', () => {
    const msg = apiErrorMessage({ response: { data: { message: 'Un produit existe déjà avec ce code-barres (123) : Coca.' } } });
    expect(msg).toMatch(/existe déjà/);
  });
});

describe('confirmsPosAvailability — honnêteté du message « publié en caisse »', () => {
  it('serveur confirme isActive=true ET status=active → disponible en caisse', () => {
    expect(confirmsPosAvailability({ id: 'p1', isActive: true, status: 'active' })).toBe(true);
  });

  it('enregistré mais NON disponible caisse : status draft / pending / isActive false → false', () => {
    expect(confirmsPosAvailability({ isActive: true, status: 'draft' })).toBe(false);
    expect(confirmsPosAvailability({ isActive: true, status: 'pending_validation' })).toBe(false);
    expect(confirmsPosAvailability({ isActive: false, status: 'active' })).toBe(false);
    expect(confirmsPosAvailability({ status: 'active' })).toBe(false); // isActive absent
  });

  it('réponse vide / non-objet / valeurs truthy non strictes → false (jamais d’annonce non vérifiée)', () => {
    expect(confirmsPosAvailability(null)).toBe(false);
    expect(confirmsPosAvailability(undefined)).toBe(false);
    expect(confirmsPosAvailability('active')).toBe(false);
    expect(confirmsPosAvailability({ isActive: 'true', status: 'active' })).toBe(false); // string, pas boolean
    expect(confirmsPosAvailability({ isActive: 1, status: 'active' })).toBe(false);
  });
});
