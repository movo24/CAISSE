import { isServerNewerThanSync, resolveCustomerSync } from './conflict';

describe('POS-049/086 sync conflict', () => {
  const lastSync = '2026-06-28T10:00:00Z';

  describe('isServerNewerThanSync', () => {
    it('true when server updated after lastSync', () => {
      expect(isServerNewerThanSync('2026-06-28T11:00:00Z', lastSync)).toBe(true);
    });
    it('false when server updated before/at lastSync', () => {
      expect(isServerNewerThanSync('2026-06-28T09:00:00Z', lastSync)).toBe(false);
      expect(isServerNewerThanSync(lastSync, lastSync)).toBe(false);
    });
  });

  describe('resolveCustomerSync', () => {
    it('saves incoming when no existing server record', () => {
      const r = resolveCustomerSync({ id: 'c1', loyaltyPoints: 10 }, undefined, lastSync);
      expect(r.save).toBe(true);
      expect(r.conflict).toBeUndefined();
    });
    it('saves incoming when server not newer than last sync', () => {
      const r = resolveCustomerSync(
        { id: 'c1', loyaltyPoints: 10 },
        { updatedAt: '2026-06-28T09:00:00Z', loyaltyPoints: 5 },
        lastSync,
      );
      expect(r.save).toBe(true);
    });
    it('reports server_wins conflict when server changed since last sync', () => {
      const r = resolveCustomerSync(
        { id: 'c1', loyaltyPoints: 10 },
        { updatedAt: '2026-06-28T11:00:00Z', loyaltyPoints: 5 },
        lastSync,
      );
      expect(r.save).toBe(false);
      expect(r.conflict).toMatchObject({
        entity: 'customer',
        entityId: 'c1',
        field: 'loyaltyPoints',
        localValue: 10,
        serverValue: 5,
        resolution: 'server_wins',
      });
    });
  });
});
