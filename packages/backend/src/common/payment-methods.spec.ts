import { PAYMENT_METHODS, isAllowedPaymentMethod } from './payment-methods';

describe('POS-040/043 payment-methods', () => {
  it('includes store_credit (avoir) — regression guard', () => {
    expect(PAYMENT_METHODS).toContain('store_credit');
  });
  it('includes the core tenders', () => {
    for (const m of ['cash', 'card', 'mobile', 'check', 'voucher']) {
      expect(isAllowedPaymentMethod(m)).toBe(true);
    }
  });
  it('rejects unknown methods', () => {
    expect(isAllowedPaymentMethod('bitcoin')).toBe(false);
    expect(isAllowedPaymentMethod('')).toBe(false);
  });
});
