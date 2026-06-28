import { roleLevel, roleSatisfies } from './role-hierarchy';

describe('POS-090 role-hierarchy', () => {
  describe('roleLevel', () => {
    it('maps known roles', () => {
      expect(roleLevel('cashier')).toBe(0);
      expect(roleLevel('manager')).toBe(1);
      expect(roleLevel('admin')).toBe(2);
    });
    it('unknown / missing = -1', () => {
      expect(roleLevel('ghost')).toBe(-1);
      expect(roleLevel(undefined)).toBe(-1);
      expect(roleLevel(null)).toBe(-1);
    });
  });

  describe('roleSatisfies (higher inherits lower)', () => {
    it('admin satisfies manager and cashier', () => {
      expect(roleSatisfies('admin', ['manager'])).toBe(true);
      expect(roleSatisfies('admin', ['cashier'])).toBe(true);
      expect(roleSatisfies('admin', ['admin'])).toBe(true);
    });
    it('manager satisfies manager/cashier but NOT admin', () => {
      expect(roleSatisfies('manager', ['manager'])).toBe(true);
      expect(roleSatisfies('manager', ['cashier'])).toBe(true);
      expect(roleSatisfies('manager', ['admin'])).toBe(false);
    });
    it('cashier satisfies only cashier', () => {
      expect(roleSatisfies('cashier', ['cashier'])).toBe(true);
      expect(roleSatisfies('cashier', ['manager'])).toBe(false);
      expect(roleSatisfies('cashier', ['admin'])).toBe(false);
    });
    it('multiple required roles → satisfied if any is met', () => {
      expect(roleSatisfies('manager', ['manager', 'admin'])).toBe(true);
    });
    it('unknown user role denied', () => {
      expect(roleSatisfies('ghost', ['cashier'])).toBe(false);
    });
    it('unknown required role never satisfied (even admin)', () => {
      expect(roleSatisfies('admin', ['superuser'])).toBe(false);
    });
    it('empty required list = not satisfied', () => {
      expect(roleSatisfies('admin', [])).toBe(false);
    });
  });
});
