/**
 * Hard guard on computed_at (structural idempotence). Deterministic unit test of
 * guardedProjectionUpsert with a mock logger: a stale `now` is rejected + WARNED
 * (keeping the fresher row); a fresh / same-instant `now` writes.
 */
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { AnalyticsStoreStockEntity } from '../src/database/entities/analytics-store-stock.entity';
import { guardedProjectionUpsert } from '../src/modules/analytics-projection/projection-upsert.util';

describe('guardedProjectionUpsert — computed_at hard guard', () => {
  let ds: DataSource;
  const STORE = uuidv4();

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('writes fresh, REJECTS+WARNS on a stale clock (row unchanged), accepts the same instant', async () => {
    const repo = ds.getRepository(AnalyticsStoreStockEntity);
    const logger = { warn: jest.fn() } as unknown as Logger;
    const t = Date.now();
    const fresh = new Date(t);

    // 1) initial write
    const r1 = await guardedProjectionUpsert(repo, { storeId: STORE }, { storeId: STORE, ruptureCount: 3, lowStockCount: 1, computedAt: fresh }, fresh, logger, 'stock');
    expect(r1).toBe('written');
    expect(logger.warn).not.toHaveBeenCalled();

    // 2) STALE clock → rejected + warned, row unchanged (the 99s never land)
    const stale = new Date(t - 60_000);
    const r2 = await guardedProjectionUpsert(repo, { storeId: STORE }, { storeId: STORE, ruptureCount: 99, lowStockCount: 99, computedAt: stale }, stale, logger, 'stock');
    expect(r2).toBe('rejected');
    expect(logger.warn).toHaveBeenCalledTimes(1); // NOT silent
    const row = await repo.findOne({ where: { storeId: STORE } });
    expect(row!.ruptureCount).toBe(3); // unchanged
    expect(new Date(row!.computedAt).getTime()).toBe(t);

    // 3) SAME instant (now === existing) → still writes → idempotent re-run is fine
    const r3 = await guardedProjectionUpsert(repo, { storeId: STORE }, { storeId: STORE, ruptureCount: 5, lowStockCount: 2, computedAt: fresh }, fresh, logger, 'stock');
    expect(r3).toBe('written');
    expect((await repo.findOne({ where: { storeId: STORE } }))!.ruptureCount).toBe(5);
  });
});
