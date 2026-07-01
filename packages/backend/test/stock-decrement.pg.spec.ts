/**
 * Real-Postgres twin for the atomic stock decrement (gated on TEST_DATABASE_URL
 * — skipped otherwise).
 *
 * WHY: pg-mem mis-evaluates `col - $param` by swapping operands (proven probe:
 * `SELECT 12 - $1` with [3] → -9 ; `SELECT 3 - $1` with [5] → 2), so the exact
 * value semantics of `SET stock_quantity = GREATEST(0, stock_quantity - :qty)`
 * can only be proven against a genuine Postgres. The pg-mem suite
 * (stock.service.pgmem.spec.ts) covers tenant scope / predicates / outbox;
 * THIS suite pins the clamp + exact arithmetic + concurrency safety.
 *
 *   TEST_DATABASE_URL=postgresql://user@localhost:5432/caisse_e2e \
 *     npx jest --forceExit test/stock-decrement.pg.spec.ts
 */
import './helpers/env-setup';
import { DataSource } from 'typeorm';

import { loadAllEntities } from './helpers/pgmem';
import { ProductEntity } from '../src/database/entities/product.entity';
import { StoreEntity } from '../src/database/entities/store.entity';

const TEST_DB = process.env.TEST_DATABASE_URL;
const d = TEST_DB ? describe : describe.skip;

d('Atomic stock decrement (real Postgres)', () => {
  let dataSource: DataSource;
  let storeId: string;

  const decrementSql = async (productId: string, qty: number) =>
    dataSource
      .createQueryBuilder()
      .update(ProductEntity)
      .set({ stockQuantity: () => `GREATEST(0, "stock_quantity" - :qty)` })
      .where('id = :id AND store_id = :storeId', { id: productId, storeId, qty })
      .execute();

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: TEST_DB,
      entities: loadAllEntities() as any,
      synchronize: true,
    });
    await dataSource.initialize();
    const stores = dataSource.getRepository(StoreEntity);
    storeId = (await stores.save(stores.create({ name: `pgstock-${Date.now()}` }))).id;
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.getRepository(ProductEntity).delete({ storeId });
      await dataSource.getRepository(StoreEntity).delete({ id: storeId });
      await dataSource.destroy();
    }
  });

  async function mkProduct(qty: number): Promise<ProductEntity> {
    const repo = dataSource.getRepository(ProductEntity);
    return repo.save(
      repo.create({
        ean: `pg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: 'pg stock probe',
        priceMinorUnits: 100,
        stockQuantity: qty,
        storeId,
      } as Partial<ProductEntity>),
    );
  }

  it('subtracts exactly and clamps at 0 (GREATEST) — the pg-mem blind spot', async () => {
    const repo = dataSource.getRepository(ProductEntity);
    const p = await mkProduct(12);

    await decrementSql(p.id, 3);
    expect((await repo.findOneBy({ id: p.id }))!.stockQuantity).toBe(9); // exact arithmetic

    await decrementSql(p.id, 50);
    expect((await repo.findOneBy({ id: p.id }))!.stockQuantity).toBe(0); // clamped, never negative
  });

  it('is atomic under concurrency: 10 parallel decrements of 1 from 6 land exactly at 0 (no lost update, no negative)', async () => {
    const repo = dataSource.getRepository(ProductEntity);
    const p = await mkProduct(6);
    await Promise.all(Array.from({ length: 10 }, () => decrementSql(p.id, 1)));
    expect((await repo.findOneBy({ id: p.id }))!.stockQuantity).toBe(0);
  });
});
