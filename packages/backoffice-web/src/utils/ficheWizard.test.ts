import { describe, it, expect } from 'vitest';
import {
  WIZARD_STEPS, validateStep, validateAll, stepHasContent, isNaAllowed, recapWarnings,
  type WizardContext, type WizardStep,
} from './ficheWizard';
import type { FicheFormShape } from './ficheValidation';

/** Formulaire COMPLET et valide (base des cas). */
const validForm = (): FicheFormShape => ({
  ean: '3760999000777', name: 'Produit test', description: '', categoryId: 'cat-1',
  sku: 'SKU-1', brandId: '', supplierId: '',
  status: 'active', productType: 'simple', unitType: 'unit', imageUrl: '',
  bestBeforeDate: '', useByDate: '',
  priceTtc: '1,00', cost: '', taxRate: '5,5',
  stock: '10', alertThreshold: '5', criticalThreshold: '2',
  shortName: 'Produit test', internalRef: '', supplierRef: '',
  countryOfOrigin: '', leadTimeDays: '', minOrderQuantity: '',
  weightGrams: '', widthMm: '', heightMm: '', depthMm: '',
  volumeMl: '', unitsPerCarton: '',
  isSeasonal: false, seasonStartMonth: '', seasonEndMonth: '',
  minPrice: '', recommendedPrice: '', unitsPerPack: '',
  cartonsPerPallet: '', allergens: '', ingredients: '', lotNumber: '',
});

const ctx = (over: Partial<WizardContext> = {}, form: Partial<FicheFormShape> = {}): WizardContext => ({
  form: { ...validForm(), ...form },
  isEdit: false,
  storeIdSelected: true,
  componentsCount: 0,
  variantsCount: 0,
  linksCount: 0,
  mediaCount: 0,
  prodSuppliersCount: 0,
  naAck: { fournisseurs: true, packs: true, variantes: true, lies: true, images: true, logistique: true },
  ...over,
});

describe('validateStep — champs obligatoires par étape', () => {
  it('Général : nom, EAN, catégorie, unité, type, nom court, SKU/réf requis', () => {
    const v = validateStep('general', ctx({}, {
      name: '', ean: '', categoryId: '', unitType: '', productType: '', shortName: '', sku: '', internalRef: '',
    }));
    expect(v.ok).toBe(false);
    for (const k of ['name', 'ean', 'categoryId', 'unitType', 'productType', 'shortName', 'sku'] as const) {
      expect(v.fieldErrors[k], k).toBeTruthy();
    }
  });

  it('Général : référence interne SEULE suffit (SKU ou réf, pas les deux)', () => {
    const v = validateStep('general', ctx({}, { sku: '', internalRef: 'REF-1' }));
    expect(v.fieldErrors.sku).toBeUndefined();
  });

  it('Général : magasin de publication NON sélectionné → étape bloquée avec message explicite', () => {
    const v = validateStep('general', ctx({ storeIdSelected: false }));
    expect(v.ok).toBe(false);
    expect(v.stepIssues.join(' ')).toMatch(/magasin/i);
  });

  it('Général : EAN invalide → message GTIN précis (clé de contrôle)', () => {
    const v = validateStep('general', ctx({}, { ean: '1234567890123' }));
    expect(v.fieldErrors.ean).toBeTruthy();
  });

  it('Tarification : prix TTC et TVA obligatoires', () => {
    const v = validateStep('tarification', ctx({}, { priceTtc: '', taxRate: '' }));
    expect(v.fieldErrors.priceTtc).toBeTruthy();
    expect(v.fieldErrors.taxRate).toBeTruthy();
  });

  it('Stock : quantité initiale obligatoire (0 accepté)', () => {
    expect(validateStep('stock', ctx({}, { stock: '' })).fieldErrors.stock).toBeTruthy();
    expect(validateStep('stock', ctx({}, { stock: '0' })).ok).toBe(true);
  });
});

describe('étapes conditionnelles (owner : jamais ignorées en silence)', () => {
  it('produit SIMPLE : aucun composant exigé, « Aucun » coché suffit', () => {
    const v = validateStep('packs', ctx({ naAck: { packs: true } }));
    expect(v.ok).toBe(true);
  });

  it('type PACK : composants OBLIGATOIRES, « Non applicable » interdit', () => {
    const c = ctx({ componentsCount: 0, naAck: { packs: true } }, { productType: 'pack' });
    expect(isNaAllowed('packs', c)).toBe(false);
    const v = validateStep('packs', c);
    expect(v.ok).toBe(false);
    expect(v.stepIssues.join(' ')).toMatch(/composant/i);
  });

  it('type PACK avec composants → étape valide', () => {
    const v = validateStep('packs', ctx({ componentsCount: 2 }, { productType: 'pack' }));
    expect(v.ok).toBe(true);
  });

  it('étape optionnelle VIDE sans accusé « Non applicable » → bloquée', () => {
    for (const step of ['fournisseurs', 'variantes', 'lies', 'images', 'logistique'] as WizardStep[]) {
      const v = validateStep(step, ctx({ naAck: {} }));
      expect(v.ok, step).toBe(false);
      expect(v.stepIssues.join(' ')).toMatch(/Non applicable/);
    }
  });

  it('étape optionnelle AVEC contenu → accusé inutile', () => {
    expect(validateStep('images', ctx({ naAck: {}, mediaCount: 1 })).ok).toBe(true);
    expect(validateStep('fournisseurs', ctx({ naAck: {} }, { supplierId: 'sup-1' })).ok).toBe(true);
    expect(stepHasContent('logistique', ctx({}, { weightGrams: '150' }))).toBe(true);
  });
});

describe('validateAll — validation finale « Valider et publier en caisse »', () => {
  it('contexte complet → ok', () => {
    const v = validateAll(ctx());
    expect(v.ok).toBe(true);
    expect(v.firstFailing).toBeNull();
  });

  it('renvoie la PREMIÈRE étape en échec (ordre du parcours)', () => {
    const v = validateAll(ctx({ storeIdSelected: false }, { taxRate: '' }));
    expect(v.ok).toBe(false);
    expect(v.firstFailing).toBe('general');
    expect(v.stepIssues.join(' ')).toMatch(/magasin/i);
  });

  it('les issues sont préfixées par le nom de l\'étape', () => {
    const v = validateAll(ctx({ naAck: {} }));
    expect(v.ok).toBe(false);
    expect(v.stepIssues.some((s) => s.startsWith('Fournisseurs :'))).toBe(true);
  });
});

describe('récapitulatif — avertissements honnêtes', () => {
  it('stock 0 → avertit que l\'encaissement sera refusé', () => {
    const w = recapWarnings(ctx({}, { stock: '0' }));
    expect(w.join(' ')).toMatch(/REFUSÉ/);
  });

  it('statut non actif → avertit du passage à Actif à la publication', () => {
    const w = recapWarnings(ctx({}, { status: 'draft' }));
    expect(w.join(' ')).toMatch(/Actif/);
  });

  it('fiche saine → aucun avertissement', () => {
    expect(recapWarnings(ctx())).toEqual([]);
  });
});

describe('parcours', () => {
  it('l\'ordre des étapes est celui ratifié, Récapitulatif en dernier', () => {
    expect(WIZARD_STEPS[0]).toBe('general');
    expect(WIZARD_STEPS[WIZARD_STEPS.length - 1]).toBe('recap');
    expect(WIZARD_STEPS).toHaveLength(10);
  });
});
