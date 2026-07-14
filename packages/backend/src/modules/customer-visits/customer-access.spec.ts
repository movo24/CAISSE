import { canAccessCustomer } from './customer-access';

describe('POS-094 canAccessCustomer (anti-IDOR)', () => {
  it('admin can access any store customer', () => {
    expect(canAccessCustomer('s2', 's1', 'admin')).toBe(true);
    expect(canAccessCustomer(null, 's1', 'admin')).toBe(true);
  });
  it('same store = allowed', () => {
    expect(canAccessCustomer('s1', 's1', 'manager')).toBe(true);
    expect(canAccessCustomer('s1', 's1', 'cashier')).toBe(true);
  });
  it('different store = denied (anti-IDOR)', () => {
    expect(canAccessCustomer('s2', 's1', 'manager')).toBe(false);
  });
  it('fail-closed on missing store ids (non-admin)', () => {
    expect(canAccessCustomer(null, 's1', 'manager')).toBe(false);
    expect(canAccessCustomer('s1', null, 'manager')).toBe(false);
    expect(canAccessCustomer(undefined, undefined, 'manager')).toBe(false);
  });
});
