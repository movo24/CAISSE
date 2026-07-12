import { MobileDirectionService } from './mobile-direction.service';

const S1 = 'store-1';
const S2 = 'store-2';
const S3 = 'store-3';

function makeService(opts: {
  activeStores: string[];
  grants?: { employeeId: string; storeId: string }[];
  queryResults?: Record<string, any[]>;
}) {
  const storeRepo = {
    find: jest.fn(async ({ where, select }: any) => {
      // find by isActive/isArchived (scope) or by ids (name map / list)
      if (Array.isArray(where)) {
        return where
          .filter((w: any) => opts.activeStores.includes(w.id))
          .map((w: any) => ({ id: w.id, name: `name-${w.id}`, city: null, isActive: true }));
      }
      return opts.activeStores.map((id) => ({ id }));
    }),
    findOne: jest.fn(async () => null),
  };
  const accessRepo = {
    find: jest.fn(async ({ where }: any) =>
      (opts.grants ?? []).filter((g) => g.employeeId === where.employeeId),
    ),
  };
  const dataSource = {
    query: jest.fn(async (_sql: string, _params?: unknown[]): Promise<any[]> => []),
  };
  const service = new MobileDirectionService(
    dataSource as any,
    storeRepo as any,
    accessRepo as any,
  );
  return { service, dataSource, storeRepo, accessRepo };
}

describe('MobileDirectionService', () => {
  describe('accessibleStoreIds (tenant scope)', () => {
    it('admin sees every active store', async () => {
      const { service } = makeService({ activeStores: [S1, S2, S3] });
      const scope = await service.accessibleStoreIds({
        employeeId: 'e1',
        storeId: S1,
        role: 'admin',
      });
      expect(scope.sort()).toEqual([S1, S2, S3].sort());
    });

    it('manager sees home store + explicit grants only', async () => {
      const { service } = makeService({
        activeStores: [S1, S2, S3],
        grants: [
          { employeeId: 'e1', storeId: S2 },
          { employeeId: 'other', storeId: S3 },
        ],
      });
      const scope = await service.accessibleStoreIds({
        employeeId: 'e1',
        storeId: S1,
        role: 'manager',
      });
      expect(scope.sort()).toEqual([S1, S2].sort());
    });

    it('an inactive/archived store never leaks back through a grant', async () => {
      const { service } = makeService({
        activeStores: [S1],
        grants: [{ employeeId: 'e1', storeId: S3 }],
      });
      const scope = await service.accessibleStoreIds({
        employeeId: 'e1',
        storeId: S1,
        role: 'manager',
      });
      expect(scope).toEqual([S1]);
    });
  });

  describe('empty scope (no accessible store)', () => {
    it('overview returns an explicit empty payload — zero SQL, no fake numbers', async () => {
      const { service, dataSource } = makeService({ activeStores: [] });
      const out = await service.overview([], '2026-07-12');
      expect(out.scope.storeCount).toBe(0);
      expect(out.today.revenueMinorUnits).toBe(0);
      expect(out.today.marginRatePct).toBeNull();
      expect(out.comparisons.vsYesterdayPct).toBeNull();
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('storeList returns an empty list without querying', async () => {
      const { service, dataSource } = makeService({ activeStores: [] });
      const out = await service.storeList([], '2026-07-12');
      expect(out.stores).toEqual([]);
      expect(dataSource.query).not.toHaveBeenCalled();
    });
  });

  describe('read-only construction', () => {
    it('every raw query issued by an overview is a SELECT', async () => {
      const { service, dataSource } = makeService({ activeStores: [S1, S2] });
      await service.overview([S1, S2], '2026-07-12');
      expect(dataSource.query.mock.calls.length).toBeGreaterThan(0);
      for (const [sql] of dataSource.query.mock.calls) {
        expect(sql.trim().toUpperCase().startsWith('SELECT')).toBe(true);
      }
    });

    it('every raw query issued by a store detail is a SELECT', async () => {
      const { service, dataSource } = makeService({ activeStores: [S1] });
      await service.storeDetail(S1, '2026-07-12');
      for (const [sql] of dataSource.query.mock.calls) {
        expect(sql.trim().toUpperCase().startsWith('SELECT')).toBe(true);
      }
    });

    it('every scope-bound query carries the scope as a bind parameter', async () => {
      const { service, dataSource } = makeService({ activeStores: [S1, S2] });
      await service.overview([S1, S2], '2026-07-12');
      for (const [sql, params] of dataSource.query.mock.calls) {
        if (sql.includes('ANY($1)')) {
          expect((params ?? [])[0]).toEqual([S1, S2]);
        }
      }
    });
  });
});
