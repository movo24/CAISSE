import {
  evaluateManualDiscount,
  distributeManualDiscount,
  DiscountPolicyViolation,
  POS_HARD_DISCOUNT_CAP_PCT,
  JUSTIFICATION_REQUIRED_FROM_PCT,
} from './discount-policy';

/**
 * POS-054 boundary hardening (verification only — asserts CURRENT behavior).
 * Complements discount-policy.spec.ts; isolates the fiscal-sensitive edges.
 */
describe('POS-054 discount-policy — boundaries (verification)', () => {
  const code = (over: Partial<Parameters<typeof evaluateManualDiscount>[0]> = {}) =>
    evaluateManualDiscount({
      channel: 'pos',
      subtotalMinorUnits: 10000,
      manualDiscountMinorUnits: 0,
      responsableCodeProvided: true,
      justification: 'Geste commercial client fidèle',
      ...over,
    });

  it('constants are the ratified values', () => {
    expect(POS_HARD_DISCOUNT_CAP_PCT).toBe(30);
    expect(JUSTIFICATION_REQUIRED_FROM_PCT).toBe(21);
  });

  it('20.99% does NOT require justification (just below 21)', () => {
    const r = code({ manualDiscountMinorUnits: 2099, justification: null });
    expect(r.discountPct).toBe(20.99);
    expect(r.justificationRequired).toBe(false);
  });

  it('exactly 21% REQUIRES a justification', () => {
    expect(() => code({ manualDiscountMinorUnits: 2100, justification: null })).toThrow(
      DiscountPolicyViolation,
    );
    const ok = code({ manualDiscountMinorUnits: 2100 });
    expect(ok.justificationRequired).toBe(true);
    expect(ok.justificationAccepted).toBe(true);
  });

  it('exactly 30% is allowed (with code + justification)', () => {
    const r = code({ manualDiscountMinorUnits: 3000 });
    expect(r.discountPct).toBe(30);
  });

  it('30.01% is REFUSED at the hard cap even with code + justification', () => {
    try {
      code({ manualDiscountMinorUnits: 3001 });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(DiscountPolicyViolation);
      expect((e as DiscountPolicyViolation).code).toBe('POS_OVER_CAP');
    }
  });

  it('generic justification ("client") is rejected at 21-30%', () => {
    try {
      code({ manualDiscountMinorUnits: 2500, justification: 'client' });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as DiscountPolicyViolation).code).toBe('JUSTIFICATION_INVALID');
    }
  });

  it('any discount > 0 without responsable code is refused', () => {
    try {
      code({ manualDiscountMinorUnits: 500, responsableCodeProvided: false, justification: null });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as DiscountPolicyViolation).code).toBe('RESPONSABLE_REQUIRED');
    }
  });

  it('back-office cannot exceed 30% without motif + validator', () => {
    try {
      evaluateManualDiscount({
        channel: 'backoffice',
        subtotalMinorUnits: 10000,
        manualDiscountMinorUnits: 5000,
        responsableCodeProvided: false,
        justification: null,
        actorRole: 'admin',
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as DiscountPolicyViolation).code).toBe('BACKOFFICE_MOTIF_REQUIRED');
    }
  });

  it('back-office 50% allowed for admin WITH motif + validator', () => {
    const r = evaluateManualDiscount({
      channel: 'backoffice',
      subtotalMinorUnits: 10000,
      manualDiscountMinorUnits: 5000,
      responsableCodeProvided: true,
      justification: 'Litige résolu, avoir commercial direction',
      actorRole: 'admin',
    });
    expect(r.discountPct).toBe(50);
  });
});

describe('distributeManualDiscount — NF525 exactness (verification)', () => {
  it('sum of per-line discounts equals the cart discount exactly', () => {
    const lines = [333, 333, 334];
    const out = distributeManualDiscount(lines, 100);
    expect(out.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('no line is discounted below 0 / above its net', () => {
    const lines = [10, 990];
    const out = distributeManualDiscount(lines, 500);
    expect(out.reduce((a, b) => a + b, 0)).toBe(500);
    out.forEach((d, i) => {
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(lines[i]);
    });
  });

  it('discount > remaining cart net is refused', () => {
    try {
      distributeManualDiscount([100, 100], 250);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as DiscountPolicyViolation).code).toBe('MANUAL_EXCEEDS_CART');
    }
  });

  it('zero discount → all zeros', () => {
    expect(distributeManualDiscount([100, 200], 0)).toEqual([0, 0]);
  });
});
