import { describe, it, expect } from 'vitest';
import { buildProductPayload, eurosToCents } from './product-payload';

// P310 (TD-061-UI) — the payload must contain ONLY DTO-valid keys: the backend
// runs forbidNonWhitelisted, so price/stock/category/storeId would be a 400.

const FORM = { name: ' Ourson ', ean: ' E-1 ', price: '5,50', stock: '12', category: '' };

describe('buildProductPayload', () => {
  it('emits DTO keys only — never price/stock/category/storeId', () => {
    const p = buildProductPayload({ ...FORM }, { editing: false });
    expect(p).toEqual({ name: 'Ourson', ean: 'E-1', priceMinorUnits: 550, stockQuantity: 12 });
    for (const forbidden of ['price', 'stock', 'category', 'storeId']) {
      expect(p).not.toHaveProperty(forbidden);
    }
  });

  it('sends categoryId only when the value is a real uuid (display fallbacks dropped)', () => {
    const id = '9e107d9d-372b-4a6e-b3a5-d5f6f7a8b9c0';
    expect(buildProductPayload({ ...FORM, category: id }, { editing: false }).categoryId).toBe(id);
    expect(buildProductPayload({ ...FORM, category: 'Non classe' }, { editing: false })).not.toHaveProperty('categoryId');
  });

  it('POS-061 override: edit sends centimes when set, EXPLICIT null when cleared; create never sends it', () => {
    expect(buildProductPayload({ ...FORM, priceOverride: '7.50' }, { editing: true }).priceOverrideMinorUnits).toBe(750);
    expect(buildProductPayload({ ...FORM, priceOverride: '' }, { editing: true }).priceOverrideMinorUnits).toBeNull();
    expect(buildProductPayload({ ...FORM, priceOverride: '7.50' }, { editing: false })).not.toHaveProperty('priceOverrideMinorUnits');
  });

  it('eurosToCents: comma tolerated, garbage/negative → 0', () => {
    expect(eurosToCents('5,50')).toBe(550);
    expect(eurosToCents('abc')).toBe(0);
    expect(eurosToCents('-3')).toBe(0);
  });
});
