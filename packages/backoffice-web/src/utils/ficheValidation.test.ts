import { describe, expect, it } from 'vitest';
import { gtinIssue, isValidGtin } from './gtin';
import {
  errorSummary,
  firstErrorField,
  mapApiError,
  tabOfField,
  validateFiche,
  type FicheFormShape,
} from './ficheValidation';

/**
 * Couvre les 10 scénarios obligatoires du correctif « Erreur de validation »
 * création produit (2026-07-21), au niveau des fonctions pures branchées sur
 * ProductEditPage.
 */

const validForm: FicheFormShape = {
  ean: '4006381333931', name: 'Tablette test', description: '', categoryId: '',
  sku: '', brandId: 'b0b7e6a2-0000-4000-8000-000000000001', supplierId: '',
  status: 'active', productType: 'simple', unitType: 'unit', imageUrl: '',
  bestBeforeDate: '', useByDate: '',
  priceTtc: '2,50', cost: '', taxRate: '20',
  stock: '0', alertThreshold: '10', criticalThreshold: '5',
  shortName: 'Tablette', internalRef: '', supplierRef: '',
  countryOfOrigin: '', leadTimeDays: '', minOrderQuantity: '',
  weightGrams: '', widthMm: '', heightMm: '', depthMm: '',
  volumeMl: '', unitsPerCarton: '',
  isSeasonal: false, seasonStartMonth: '', seasonEndMonth: '',
  minPrice: '', recommendedPrice: '', unitsPerPack: '',
  cartonsPerPallet: '', allergens: '', ingredients: '', lotNumber: '',
};

describe('scénario 1+2 — produit simple valide, catégorie absente (facultative)', () => {
  it('aucune erreur : le scénario utilisateur (nom+EAN+marque+actif+nom court, catégorie Aucune) passe', () => {
    expect(validateFiche(validForm, false)).toEqual({});
  });
});

describe('scénarios 4+5+6 — formats EAN', () => {
  it('EAN-13 valide accepté', () => expect(isValidGtin('4006381333931')).toBe(true));
  it('EAN-8 valide accepté', () => expect(isValidGtin('96385074')).toBe(true));
  it('UPC-A (12) valide accepté', () => expect(isValidGtin('036000291452')).toBe(true));

  it('lettres → message précis sous Code EAN', () => {
    const errors = validateFiche({ ...validForm, ean: 'ABC123' }, false);
    expect(errors.ean).toMatch(/sans lettres ni espaces/);
    expect(tabOfField('ean')).toBe('general');
  });
  it('longueur invalide → « 8 ou 13 chiffres attendus »', () => {
    const errors = validateFiche({ ...validForm, ean: '12345' }, false);
    expect(errors.ean).toMatch(/8 ou 13 chiffres attendus/);
  });
  it('clé de contrôle fausse → message dédié', () => {
    const errors = validateFiche({ ...validForm, ean: '4006381333932' }, false);
    expect(errors.ean).toMatch(/clé de contrôle incorrecte/);
    expect(gtinIssue('4006381333932')).toBe('checksum');
  });
  it('EAN vide en création → obligatoire ; jamais requis en modification (EAN immuable)', () => {
    expect(validateFiche({ ...validForm, ean: '' }, false).ean).toMatch(/obligatoire/);
    expect(validateFiche({ ...validForm, ean: '' }, true).ean).toBeUndefined();
  });
});

describe('scénario 8 — prix obligatoire absent → onglet Tarification', () => {
  it('erreur précise sous Prix de vente TTC, onglet tarification', () => {
    const errors = validateFiche({ ...validForm, priceTtc: '' }, false);
    expect(errors.priceTtc).toBe('Le prix de vente TTC est obligatoire (ex. 4,50).');
    expect(firstErrorField(errors)).toBe('priceTtc');
    expect(tabOfField('priceTtc')).toBe('tarification');
  });
  it('TVA à 0 est valide (pas de retombée silencieuse sur 20 %)', () => {
    expect(validateFiche({ ...validForm, taxRate: '0' }, false)).toEqual({});
  });
});

describe('scénario 9 — erreurs dans plusieurs onglets', () => {
  it('résumé chiffré + premier onglet concerné en premier', () => {
    const errors = validateFiche(
      { ...validForm, ean: 'XX', priceTtc: '', weightGrams: '-4' },
      false,
    );
    expect(Object.keys(errors)).toHaveLength(3);
    expect(errorSummary(errors)).toBe('Impossible d’enregistrer : 3 champs doivent être corrigés.');
    // Ordre visuel : l'EAN (Général) avant la tarification et la logistique.
    expect(firstErrorField(errors)).toBe('ean');
  });
  it('résumé singulier pour une seule erreur', () => {
    expect(errorSummary({ priceTtc: 'x' })).toBe('Impossible d’enregistrer : 1 champ doit être corrigé.');
  });
});

describe('scénarios 7+10 — erreurs backend mappées, saisies conservées', () => {
  it('doublon code-barres (409) → message sous Code EAN avec le produit existant', () => {
    const mapped = mapApiError({
      success: false,
      code: 'PRODUCT_BARCODE_ALREADY_EXISTS',
      message: 'Un produit existe déjà avec ce code-barres (4006381333931) : Tablette test.',
      statusCode: 409,
      details: { existingProduct: { id: 'x', name: 'Tablette test' } },
    });
    expect(mapped.fieldErrors.ean).toBe('Ce code-barres existe déjà (produit : Tablette test).');
    expect(mapped.incompatible).toBe(false);
  });

  it('doublon SKU (409) → message sous SKU', () => {
    const mapped = mapApiError({ code: 'PRODUCT_SKU_ALREADY_EXISTS', details: { existingProduct: { name: 'P1' } } });
    expect(mapped.fieldErrors.sku).toBe('Ce SKU existe déjà (produit : P1).');
  });

  it('VALIDATION_ERROR avec `fields` structurés → chaque erreur sous son champ, traduite', () => {
    const mapped = mapApiError({
      code: 'VALIDATION_ERROR',
      message: 'Erreur de validation.',
      details: ['priceMinorUnits must be an integer number', 'brandId must be a UUID'],
      fields: {
        priceMinorUnits: ['priceMinorUnits must be an integer number'],
        brandId: ['brandId must be a UUID'],
      },
    });
    expect(mapped.fieldErrors.priceTtc).toBe('Nombre entier attendu.');
    expect(mapped.fieldErrors.brandId).toMatch(/choisissez une valeur dans la liste/);
    expect(mapped.banner).toBeNull();
  });

  it('VALIDATION_ERROR ancien serveur (details plats, sans fields) → toujours mappé', () => {
    const mapped = mapApiError({
      code: 'VALIDATION_ERROR',
      details: ['stockQuantity must not be less than 0'],
    });
    expect(mapped.fieldErrors.stock).toBe('Doit être supérieur ou égal à 0.');
  });

  it('propriétés inconnues du serveur (« should not exist ») → bandeau désalignement de versions', () => {
    const mapped = mapApiError({
      code: 'VALIDATION_ERROR',
      details: [
        'property shortName should not exist',
        'property productType should not exist',
        'property isSeasonal should not exist',
      ],
    });
    expect(mapped.incompatible).toBe(true);
    expect(mapped.banner).toMatch(/versions de l’interface et du serveur sont désalignées/);
    expect(mapped.banner).toMatch(/shortName, productType, isSeasonal/);
    // Aucune fausse erreur de champ : le problème n'est pas la saisie.
    expect(mapped.fieldErrors).toEqual({});
  });

  it('message EAN métier du serveur transmis tel quel (déjà en français)', () => {
    const mapped = mapApiError({
      code: 'VALIDATION_ERROR',
      fields: { ean: ['Code EAN invalide : 8 ou 13 chiffres attendus (sans lettres ni espaces), avec une clé de contrôle valide.'] },
    });
    expect(mapped.fieldErrors.ean).toMatch(/^Code EAN invalide/);
  });

  it('erreur inconnue → bandeau exploitable, jamais silencieux', () => {
    const mapped = mapApiError(undefined);
    expect(mapped.banner).toMatch(/saisies sont conservées/);
  });
});
