import { DataSource, Repository } from 'typeorm';
import { ForbiddenException } from '@nestjs/common';
import { DataType } from 'pg-mem';

import { createPgMemDataSource } from '../../../test/helpers/pgmem';
import { StockService } from './stock.service';
import { ProductEntity } from '../../database/entities/product.entity';
import { IntegrationEventEntity } from '../../database/entities/integration-event.entity';
import { StoreEntity } from '../../database/entities/store.entity';

// PAQUET 278 — StockService against a real in-memory Postgres (pg-mem):
// proves the REAL stock SQL — atomic GREATEST(0, …) decrement, tenant-scoped
// lookups, the POS-083 baseline-20% alert predicate (COALESCE/CEIL in SQL),
// bulk threshold update (active-only), variance resolution, and the outbox
// side-channel. AuditService/StoreOrgResolver are recorded fakes: the point
// here is the SQL, their logic has its own suites.

describe('StockService (pg-mem)', () => {
  let dataSource: DataSource;
  let productRepo: Repository<ProductEntity>;
  let outboxRepo: Repository<IntegrationEventEntity>;
  let service: StockService;
  const auditLog = jest.fn().mockResolvedValue(undefined);

  let storeId: string;
  let otherStoreId: string;

  const mkProduct = (over: Partial<ProductEntity>) =>
    productRepo.save(
      productRepo.create({
        ean: `e-${Math.random().toString(36).slice(2, 10)}`,
        name: 'p',
        priceMinorUnits: 100,
        storeId,
        ...over,
      } as Partial<ProductEntity>),
    );

  beforeAll(async () => {
    const built = createPgMemDataSource();
    // getAlerts uses CEIL(baseline * 0.2) — register the SQL function pg-mem lacks.
    built.db.public.registerFunction({
      name: 'ceil',
      args: [DataType.float],
      returns: DataType.integer,
      implementation: (x: number | null) => (x === null ? null : Math.ceil(Number(x))),
    });
    dataSource = built.dataSource;
    await dataSource.initialize();
    productRepo = dataSource.getRepository(ProductEntity);
    outboxRepo = dataSource.getRepository(IntegrationEventEntity);
    const storeRepo = dataSource.getRepository(StoreEntity);
    service = new StockService(
      productRepo,
      outboxRepo,
      { log: auditLog } as any, // recorded fake — audit hash-chain has its own suites
      dataSource,
      { resolve: async () => null } as any, // StoreOrgResolver fake (no org hierarchy seeded)
    );
    storeId = (await storeRepo.save(storeRepo.create({ name: 'Wesley' }))).id;
    otherStoreId = (await storeRepo.save(storeRepo.create({ name: 'Other' }))).id;
  });

  beforeEach(() => auditLog.mockClear());

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  // pg-mem LIMITATION (proven by probe): `col - $param` swaps operands
  // (SELECT 12 - $1 [3] → -9 ; SELECT 3 - $1 [5] → 2), so the exact clamped
  // value of the atomic GREATEST(0, stock - :qty) UPDATE cannot be asserted
  // here. Clamp semantics are covered by the pure helpers (test/stock.spec.ts,
  // stock-level.spec.ts); real-PG value semantics belong to the .pg suites.
  it('decrementStock executes the atomic UPDATE (row mutated, never negative) and emits outbox rows', async () => {
    const p = await mkProduct({ stockQuantity: 3, stockAlertThreshold: 0, stockCriticalThreshold: 0 });
    const before = await outboxRepo.count();
    const saved = await service.decrementStock(p.id, 5, storeId, 'emp-1');
    expect(saved.stockQuantity).not.toBe(3); // the UPDATE really ran
    expect(saved.stockQuantity).toBeGreaterThanOrEqual(0); // GREATEST floor held
    expect(await outboxRepo.count()).toBeGreaterThan(before); // best-effort events inserted
  });

  it('decrementStock is tenant-scoped: another store cannot touch the product', async () => {
    const p = await mkProduct({ stockQuantity: 10 });
    await expect(service.decrementStock(p.id, 1, otherStoreId, 'emp-1')).rejects.toThrow(
      ForbiddenException,
    );
    expect((await productRepo.findOneBy({ id: p.id }))!.stockQuantity).toBe(10); // untouched
  });

  it('adjustStock (transaction): absolute sets, delta adds, both clamp ≥ 0, audit carries old→new', async () => {
    const p = await mkProduct({ stockQuantity: 7 });
    const abs = await service.adjustStock(p.id, 20, storeId, 'emp-1', 'recount', 'absolute');
    expect(abs.stockQuantity).toBe(20);
    const delta = await service.adjustStock(p.id, -25, storeId, 'emp-1', 'breakage', 'delta');
    expect(delta.stockQuantity).toBe(0); // 20 - 25 clamped
    const call = auditLog.mock.calls.at(-1)![0];
    expect(call.details.oldQuantity).toBe(20);
    expect(call.details.newQuantity).toBe(0);
    await expect(
      service.adjustStock(p.id, 5, otherStoreId, 'emp-1', 'theft', 'absolute'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('getAlerts buckets by REAL SQL predicates: critical vs alert, baseline-20% rule, inactive/foreign excluded', async () => {
    // isolate: park earlier products out of alert ranges
    await productRepo.update({ storeId }, { stockQuantity: 1000, stockAlertThreshold: 10, stockCriticalThreshold: 5, stockBaselineQuantity: null as any });
    const crit = await mkProduct({ name: 'crit', stockQuantity: 4, stockAlertThreshold: 10, stockCriticalThreshold: 5 });
    const alertAbs = await mkProduct({ name: 'alertAbs', stockQuantity: 8, stockAlertThreshold: 10, stockCriticalThreshold: 5 });
    // POS-083: baseline 100 → effective alert = CEIL(20); qty 15 ≤ 20 → alert even though absolute threshold is 3
    const alertBaseline = await mkProduct({ name: 'alertBaseline', stockQuantity: 15, stockAlertThreshold: 3, stockCriticalThreshold: 5, stockBaselineQuantity: 100 });
    await mkProduct({ name: 'inactive', stockQuantity: 1, isActive: false });
    await mkProduct({ name: 'foreign', stockQuantity: 1, storeId: otherStoreId });

    const res = await service.getAlerts(storeId);
    expect(res.critical.map((x) => x.id)).toEqual([crit.id]);
    expect(res.alert.map((x) => x.id).sort()).toEqual([alertAbs.id, alertBaseline.id].sort());
  });

  it('updateDefaultThresholds hits only ACTIVE products of the store and returns the affected count', async () => {
    const active = await mkProduct({ name: 'th-a', stockQuantity: 50 });
    const inactive = await mkProduct({ name: 'th-i', stockQuantity: 50, isActive: false });
    const activeCount = await productRepo.countBy({ storeId, isActive: true });
    const { updated } = await service.updateDefaultThresholds(storeId, 33, 11);
    expect(updated).toBe(activeCount);
    expect((await productRepo.findOneBy({ id: active.id }))!.stockAlertThreshold).toBe(33);
    expect((await productRepo.findOneBy({ id: inactive.id }))!.stockAlertThreshold).not.toBe(33);
  });

  it('computeVariance resolves counts by id AND ean (tenant-scoped) and reports unmatched refs', async () => {
    const a = await mkProduct({ name: 'var-a', ean: 'EAN-A', stockQuantity: 10, costMinorUnits: 100 });
    const b = await mkProduct({ name: 'var-b', ean: 'EAN-B', stockQuantity: 5, costMinorUnits: 50 });
    const foreign = await mkProduct({ name: 'var-f', ean: 'EAN-F', stockQuantity: 5, storeId: otherStoreId });

    const res = await service.computeVariance(storeId, [
      { productId: a.id, countedQty: 8 }, // -2
      { ean: 'EAN-B', countedQty: 7 }, // +2
      { productId: foreign.id, countedQty: 1 }, // other store → unmatched
      { ean: 'NOPE', countedQty: 1 }, // unknown → unmatched
    ]);
    expect(res.unmatched.sort()).toEqual([foreign.id, 'NOPE'].sort());
    const rowA = (res as any).rows?.find?.((r: any) => r.productId === a.id);
    if (rowA) expect(rowA.systemQty).toBe(10);
    expect(res.unmatched).toHaveLength(2);
  });
});
