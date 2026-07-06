import { describe, it, expect } from 'vitest';
import {
  eurosToMinorUnits,
  buildProductPayload,
  EMPTY_INTEGRATION_FORM,
} from './productIntegration';

describe('eurosToMinorUnits', () => {
  it('convertit les saisies FR/EN en centimes', () => {
    expect(eurosToMinorUnits('2,50')).toBe(250);
    expect(eurosToMinorUnits('2.5')).toBe(250);
    expect(eurosToMinorUnits(' 3 ')).toBe(300);
    expect(eurosToMinorUnits('0')).toBe(0);
  });
  it('rejette vide / négatif / non numérique', () => {
    expect(eurosToMinorUnits('')).toBeNull();
    expect(eurosToMinorUnits('-1')).toBeNull();
    expect(eurosToMinorUnits('abc')).toBeNull();
  });
});

describe('buildProductPayload', () => {
  const validForm = {
    ...EMPTY_INTEGRATION_FORM,
    ean: '3760123456789',
    name: 'Chips 45g',
    priceEuros: '1,20',
    brandName: 'Brets',
    initialStock: '12',
  };

  it('construit un payload complet avec code-barres prérempli', () => {
    const { payload, errors } = buildProductPayload(validForm, { activate: true, pin: '1234' });
    expect(errors).toEqual([]);
    expect(payload).toMatchObject({
      ean: '3760123456789',
      name: 'Chips 45g',
      priceMinorUnits: 120,
      brandName: 'Brets',
      stockQuantity: 12,
      activate: true,
      pin: '1234',
    });
  });

  it('bloque sans nom ou sans prix de vente', () => {
    const noName = buildProductPayload({ ...validForm, name: ' ' }, { activate: false });
    expect(noName.payload).toBeNull();
    expect(noName.errors.join(' ')).toMatch(/nom du produit/i);

    const noPrice = buildProductPayload({ ...validForm, priceEuros: '' }, { activate: false });
    expect(noPrice.errors.join(' ')).toMatch(/prix de vente/i);
  });

  it('bloque un code-barres manquant', () => {
    const res = buildProductPayload({ ...validForm, ean: '' }, { activate: false });
    expect(res.errors.join(' ')).toMatch(/code-barres/i);
  });

  it('lie la demande d’intégration via requestId', () => {
    const { payload } = buildProductPayload(validForm, { activate: false, requestId: 'req-1' });
    expect(payload).toMatchObject({ requestId: 'req-1', activate: false });
  });
});
