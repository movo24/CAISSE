import { validatePayments, PaymentPolicyViolation } from './payment-policy';

describe('POS-040/043/044/048 validatePayments', () => {
  const expectViolation = (fn: () => unknown, code: string) => {
    try {
      fn();
      throw new Error('expected PaymentPolicyViolation');
    } catch (e) {
      expect(e).toBeInstanceOf(PaymentPolicyViolation);
      expect((e as PaymentPolicyViolation).code).toBe(code);
    }
  };

  it('exact cash payment = ok, no change', () => {
    const r = validatePayments([{ method: 'cash', amountMinorUnits: 1500 }], 1500);
    expect(r.paymentTotal).toBe(1500);
    expect(r.changeMinorUnits).toBe(0);
  });

  it('cash overpayment = ok, returns change (POS-040)', () => {
    const r = validatePayments([{ method: 'cash', amountMinorUnits: 2000 }], 1500);
    expect(r.changeMinorUnits).toBe(500);
  });

  it('insufficient payment = refused', () => {
    expectViolation(
      () => validatePayments([{ method: 'cash', amountMinorUnits: 1000 }], 1500),
      'INSUFFICIENT_PAYMENT',
    );
  });

  it('mixed cash + card covering the total = ok (POS-044)', () => {
    const r = validatePayments(
      [
        { method: 'cash', amountMinorUnits: 1000 },
        { method: 'card', amountMinorUnits: 500 },
      ],
      1500,
    );
    expect(r.paymentTotal).toBe(1500);
    expect(r.changeMinorUnits).toBe(0);
  });

  it('store_credit within residual = ok (POS-043)', () => {
    const r = validatePayments(
      [
        { method: 'card', amountMinorUnits: 1000 },
        { method: 'store_credit', amountMinorUnits: 500 },
      ],
      1500,
    );
    expect(r.storeCreditRequested).toBe(500);
    expect(r.storeCreditAllowed).toBe(500);
  });

  it('store_credit exceeding residual = refused (no value destruction)', () => {
    expectViolation(
      () =>
        validatePayments(
          [
            { method: 'card', amountMinorUnits: 1000 },
            { method: 'store_credit', amountMinorUnits: 800 },
          ],
          1500,
        ),
      'STORE_CREDIT_EXCEEDS_DUE',
    );
  });

  it('card overpayment = refused (no cash change on card) (POS-INT-128)', () => {
    expectViolation(
      () => validatePayments([{ method: 'card', amountMinorUnits: 2000 }], 1500),
      'NON_CASH_OVERPAYMENT',
    );
  });

  it('cash overpays while card covers part = ok, change is cash-backed (POS-INT-128)', () => {
    const r = validatePayments(
      [
        { method: 'card', amountMinorUnits: 1000 }, // ≤ total, no card change
        { method: 'cash', amountMinorUnits: 1000 }, // cash overpays the residual 500
      ],
      1500,
    );
    expect(r.changeMinorUnits).toBe(500); // fully covered by cash
  });

  it('terminal overpayment = refused (POS-INT-128)', () => {
    expectViolation(
      () => validatePayments([{ method: 'stripe_terminal', amountMinorUnits: 1600 }], 1500),
      'NON_CASH_OVERPAYMENT',
    );
  });

  it('store_credit only, equal to total = ok', () => {
    const r = validatePayments(
      [{ method: 'store_credit', amountMinorUnits: 1500 }],
      1500,
    );
    expect(r.storeCreditAllowed).toBe(1500);
    expect(r.changeMinorUnits).toBe(0);
  });
});
