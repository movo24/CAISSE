import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { createPgMemDataSource } from './helpers/pgmem';
import { AddProductVariantsAndSuppliers1727000000000 } from '../src/database/migrations/1727000000000-AddProductVariantsAndSuppliers';

// P327 (cycle K) — dry-run migration 1727 on a genuine SQL engine.
// Target-DB execution stays gated (GATE 2 queue: 1725 → 1726 → 1727).

describe('migration 1727-AddProductVariantsAndSuppliers — dry-run (pg-mem)', () => {
  let dataSource: DataSource;
  let productId: string;

  beforeAll(async () => {
    const built = createPgMemDataSource();
    dataSource = built.dataSource;
    await dataSource.initialize();
    // simulate PRE-migration schema
    await dataSource.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "parent_product_id"`);
    await dataSource.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "variant_label"`);
    await dataSource.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "brand"`);
    await dataSource.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "supplier_id"`);
    await dataSource.query(`DROP TABLE IF EXISTS "suppliers"`);

    // products.store_id carries an FK → seed a real store first
    const storeId = uuidv4();
    await dataSource.query(`INSERT INTO stores (id, name) VALUES ($1, 'MigStore')`, [storeId]);
    productId = uuidv4();
    await dataSource.query(
      `INSERT INTO products (id, store_id, ean, name, price_minor_units) VALUES ($1, $2, 'E-MIG', 'Legacy', 100)`,
      [productId, storeId],
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('up() adds the 4 nullable columns + suppliers table; legacy rows stay NULL; double-up harmless', async () => {
    const mig = new AddProductVariantsAndSuppliers1727000000000();
    await mig.up(dataSource.createQueryRunner());
    await mig.up(dataSource.createQueryRunner()); // idempotent

    const rows = await dataSource.query(
      `SELECT parent_product_id, variant_label, brand, supplier_id FROM products WHERE id = $1`,
      [productId],
    );
    expect(rows[0]).toEqual({ parent_product_id: null, variant_label: null, brand: null, supplier_id: null });

    // suppliers table exists and enforces (store_id, name) uniqueness
    const sid = uuidv4();
    await dataSource.query(`INSERT INTO suppliers (id, store_id, name) VALUES ($1, $2, 'Haribo')`, [uuidv4(), sid]);
    await expect(
      dataSource.query(`INSERT INTO suppliers (id, store_id, name) VALUES ($1, $2, 'Haribo')`, [uuidv4(), sid]),
    ).rejects.toThrow(); // unique per store
    await dataSource.query(`INSERT INTO suppliers (id, store_id, name) VALUES ($1, $2, 'Haribo')`, [uuidv4(), uuidv4()]); // other store OK
  });

  it('down() reverts everything cleanly and is idempotent', async () => {
    const mig = new AddProductVariantsAndSuppliers1727000000000();
    await mig.down(dataSource.createQueryRunner());
    await mig.down(dataSource.createQueryRunner());

    const cols: Array<{ column_name: string }> = await dataSource.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'products'`,
    );
    const names = cols.map((c) => c.column_name);
    for (const gone of ['parent_product_id', 'variant_label', 'brand', 'supplier_id']) {
      expect(names).not.toContain(gone);
    }
    const tables: Array<{ table_name: string }> = await dataSource.query(
      `SELECT table_name FROM information_schema.tables WHERE table_name = 'suppliers'`,
    );
    expect(tables).toHaveLength(0);
  });
});
