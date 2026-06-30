import { isServerNewerThanSync, resolveCustomerSync, partitionPushSales } from './conflict';

describe('POS-049/086 sync conflict', () => {
  const lastSync = '2026-06-28T10:00:00Z';

  describe('partitionPushSales (POS-INT-136 idempotency)', () => {
    it('separates sales with id from id-less ones', () => {
      const r = partitionPushSales([
        { id: 'a', x: 1 }, { id: '', x: 2 }, { x: 3 } as any, { id: 'b', x: 4 }, { id: null, x: 5 } as any,
      ]);
      expect(r.withId.map((s: any) => s.x)).toEqual([1, 4]);
      expect(r.rejected.map((s: any) => s.x)).toEqual([2, 3, 5]);
    });
    it('empty / nullish input → empty partitions', () => {
      expect(partitionPushSales([])).toEqual({ withId: [], rejected: [] });
      expect(partitionPushSales(undefined as any)).toEqual({ withId: [], rejected: [] });
    });
    it('all valid ids → none rejected (idempotent replay possible)', () => {
      const r = partitionPushSales([{ id: 'x' }, { id: 'y' }]);
      expect(r.rejected).toHaveLength(0);
      expect(r.withId).toHaveLength(2);
    });
  });

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
