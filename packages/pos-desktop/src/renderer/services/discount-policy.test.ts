import { describe, it, expect } from 'vitest';
import { validateManualDiscount } from './discount-policy';

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
