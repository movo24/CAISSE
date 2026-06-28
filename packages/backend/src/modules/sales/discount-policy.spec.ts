import {
  evaluateManualDiscount,
  distributeManualDiscount,
  DiscountPolicyViolation,
  ManualDiscountInput,
} from './discount-policy';

/**
 * POS-054 — discount policy test matrix (product spec 2026-06-28).
 * Pure unit tests (no DB/Nest) so the full rule matrix is verifiable in isolation.
 */
describe('POS-054 evaluateManualDiscount', () => {
  const base = (over: Partial<ManualDiscountInput>): ManualDiscountInput => ({
    channel: 'pos',
    subtotalMinorUnits: 10000, // 100.00€
    manualDiscountMinorUnits: 0,
    responsableCodeProvided: false,
    justification: null,
    actorRole: 'cashier',
    ...over,
  });

  const expectViolation = (input: ManualDiscountInput, code: string) => {
    try {
      evaluateManualDiscount(input);
      throw new Error('expected DiscountPolicyViolation, none thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(DiscountPolicyViolation);
      expect((e as DiscountPolicyViolation).code).toBe(code);
    }
  };

  // --- POS caisse ---
  it('caisse 20% with responsable code = OK', () => {
    const r = evaluateManualDiscount(
      base({ manualDiscountMinorUnits: 2000, responsableCodeProvided: true }),
    );
    expect(r.discountPct).toBe(20);
    expect(r.justificationRequired).toBe(false);
  });

  it('caisse manual discount without responsable code = refused', () => {
    expectViolation(
      base({ manualDiscountMinorUnits: 2000, responsableCodeProvided: false }),
      'RESPONSABLE_REQUIRED',
    );
  });

  it('caisse 21% without justification = refused', () => {
    expectViolation(
      base({ manualDiscountMinorUnits: 2100, responsableCodeProvided: true }),
      'JUSTIFICATION_REQUIRED',
    );
  });

  it('caisse 21% with generic justification = refused', () => {
    expectViolation(
      base({ manualDiscountMinorUnits: 2100, responsableCodeProvided: true, justification: 'ok' }),
      'JUSTIFICATION_INVALID',
    );
  });

  it('caisse 21% with real justification = OK', () => {
    const r = evaluateManualDiscount(
      base({
        manualDiscountMinorUnits: 2100,
        responsableCodeProvided: true,
        justification: 'Produit abîmé',
      }),
    );
    expect(r.discountPct).toBe(21);
    expect(r.justificationRequired).toBe(true);
    expect(r.justificationAccepted).toBe(true);
  });

  it('caisse 30% with code + justification = OK', () => {
    const r = evaluateManualDiscount(
      base({
        manualDiscountMinorUnits: 3000,
        responsableCodeProvided: true,
        justification: 'Geste commercial validé',
      }),
    );
    expect(r.discountPct).toBe(30);
  });

  it('caisse 31% even with code + justification = refused (POS_OVER_CAP)', () => {
    expectViolation(
      base({
        manualDiscountMinorUnits: 3100,
        responsableCodeProvided: true,
        justification: 'Erreur prix affiché',
      }),
      'POS_OVER_CAP',
    );
  });

  it('caisse 100% from terminal = refused', () => {
    expectViolation(
      base({ manualDiscountMinorUnits: 10000, responsableCodeProvided: true, justification: 'litige' }),
      'POS_OVER_CAP',
    );
  });

  // --- Back-office ---
  it('backoffice admin 50% with motif + validator = OK', () => {
    const r = evaluateManualDiscount(
      base({
        channel: 'backoffice',
        actorRole: 'admin',
        manualDiscountMinorUnits: 5000,
        responsableCodeProvided: true,
        justification: 'Remise négociée siège',
      }),
    );
    expect(r.discountPct).toBe(50);
  });

  it('backoffice admin 100% with motif + validator = OK', () => {
    const r = evaluateManualDiscount(
      base({
        channel: 'backoffice',
        actorRole: 'admin',
        manualDiscountMinorUnits: 10000,
        responsableCodeProvided: true,
        justification: 'Avoir total exceptionnel direction',
      }),
    );
    expect(r.discountPct).toBe(100);
  });

  it('backoffice > 30% without motif = refused', () => {
    expectViolation(
      base({
        channel: 'backoffice',
        actorRole: 'admin',
        manualDiscountMinorUnits: 5000,
        responsableCodeProvided: true,
        justification: null,
      }),
      'BACKOFFICE_MOTIF_REQUIRED',
    );
  });

  it('cashier cannot use back-office channel = refused', () => {
    expectViolation(
      base({
        channel: 'backoffice',
        actorRole: 'cashier',
        manualDiscountMinorUnits: 5000,
        responsableCodeProvided: true,
        justification: 'tentative',
      }),
      'BACKOFFICE_FORBIDDEN_ROLE',
    );
  });

  it('backoffice over 100% = refused', () => {
    expectViolation(
      base({
        channel: 'backoffice',
        actorRole: 'admin',
        subtotalMinorUnits: 10000,
        manualDiscountMinorUnits: 11000,
        responsableCodeProvided: true,
        justification: 'au-delà du total',
      }),
      'BACKOFFICE_OVER_MAX',
    );
  });

  it('negative discount = refused', () => {
    expectViolation(base({ manualDiscountMinorUnits: -100 }), 'NEGATIVE_DISCOUNT');
  });
});

describe('POS-054 distributeManualDiscount', () => {
  it('sum of allocations equals the manual discount exactly', () => {
    const lines = [3333, 3333, 3334];
    const alloc = distributeManualDiscount(lines, 1000);
    expect(alloc.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('allocates proportionally for clean splits', () => {
    const alloc = distributeManualDiscount([5000, 5000], 1000);
    expect(alloc).toEqual([500, 500]);
  });

  it('largest-remainder gives leftover cent to the largest line', () => {
    // 100 split over [60,40] = [60,40] exact; use a remainder case:
    const alloc = distributeManualDiscount([67, 33], 1); // exact: 0.67/0.33 -> floors 0,0 leftover 1 -> line0
    expect(alloc).toEqual([1, 0]);
    expect(alloc.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('never discounts a line below zero (cap at its net)', () => {
    const lines = [100, 10];
    const alloc = distributeManualDiscount(lines, 110);
    expect(alloc[0]).toBeLessThanOrEqual(100);
    expect(alloc[1]).toBeLessThanOrEqual(10);
    expect(alloc.reduce((a, b) => a + b, 0)).toBe(110);
  });

  it('zero discount yields all zeros', () => {
    expect(distributeManualDiscount([100, 200], 0)).toEqual([0, 0]);
  });

  it('discount exceeding cart net = refused', () => {
    try {
      distributeManualDiscount([100, 100], 300);
      throw new Error('expected violation');
    } catch (e) {
      expect(e).toBeInstanceOf(DiscountPolicyViolation);
      expect((e as DiscountPolicyViolation).code).toBe('MANUAL_EXCEEDS_CART');
    }
  });
});
