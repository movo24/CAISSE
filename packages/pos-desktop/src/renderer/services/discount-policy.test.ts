import { describe, it, expect } from 'vitest';
import { validateManualDiscount, computePromoDiscount } from './discount-policy';

describe('manual discount policy (client mirror of decision 5)', () => {
  it('no discount → always ok', () => {
    expect(validateManualDiscount({ subtotalMinor: 2000, manualDiscountMinor: 0 }).ok).toBe(true);
  });

  it('a discount without an approver is refused', () => {
    const r = validateManualDiscount({ subtotalMinor: 2000, manualDiscountMinor: 200 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/responsable/);
  });

  it('DECISIVE — above 30% is refused even with an approver', () => {
    const r = validateManualDiscount({ subtotalMinor: 2000, manualDiscountMinor: 700, approverId: 'mgr' }); // 35%
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/plafond de 30%/);
  });

  it('exactly 30% with an approver is accepted', () => {
    expect(validateManualDiscount({ subtotalMinor: 2000, manualDiscountMinor: 600, approverId: 'mgr' }).ok).toBe(true);
  });

  it('a discount on an empty cart is refused', () => {
    expect(validateManualDiscount({ subtotalMinor: 0, manualDiscountMinor: 100, approverId: 'mgr' }).ok).toBe(false);
  });
});

describe('promo code discount (decision 6 — mirrors the server base)', () => {
  it('no info → 0', () => {
    expect(computePromoDiscount(2000, null)).toBe(0);
  });

  it('percentage uses floor of base × pct', () => {
    expect(computePromoDiscount(2000, { discountType: 'percentage', discountValue: 10 })).toBe(200);
    expect(computePromoDiscount(1999, { discountType: 'percentage', discountValue: 10 })).toBe(199); // floor(199.9)
  });

  it('fixed is capped at the base (never makes the total negative)', () => {
    expect(computePromoDiscount(2000, { discountType: 'fixed', discountValue: 500 })).toBe(500);
    expect(computePromoDiscount(300, { discountType: 'fixed', discountValue: 500 })).toBe(300);
  });

  it('non-positive base → 0', () => {
    expect(computePromoDiscount(0, { discountType: 'percentage', discountValue: 50 })).toBe(0);
    expect(computePromoDiscount(-100, { discountType: 'fixed', discountValue: 50 })).toBe(0);
  });
});
