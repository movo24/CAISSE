import { describe, it, expect, beforeEach } from 'vitest';
import { useRightsStore, ROLE_DEFAULTS } from './rightsStore';

describe('rightsStore — role → rights resolution', () => {
  beforeEach(() => useRightsStore.setState({ rights: null }));

  it('cashier defaults deny dangerous operations', () => {
    expect(ROLE_DEFAULTS.cashier.canVoidSale).toBe(false);
    expect(ROLE_DEFAULTS.cashier.canRefund).toBe(false);
  });

  it('admin & manager may void and refund', () => {
    for (const role of ['admin', 'manager'] as const) {
      expect(ROLE_DEFAULTS[role].canVoidSale).toBe(true);
      expect(ROLE_DEFAULTS[role].canRefund).toBe(true);
    }
  });

  it('setRightsForRole applies the role defaults', () => {
    useRightsStore.getState().setRightsForRole('e1', 'manager');
    const r = useRightsStore.getState().rights;
    expect(r?.role).toBe('manager');
    expect(r?.canRefund).toBe(true);
    expect(r?.employeeId).toBe('e1');
  });

  it('an unknown role falls back to cashier (least privilege)', () => {
    useRightsStore.getState().setRightsForRole('e2', 'superhacker');
    const r = useRightsStore.getState().rights;
    expect(r?.canVoidSale).toBe(false);
    expect(r?.canRefund).toBe(false);
  });
});
