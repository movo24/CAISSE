import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Brand/supplier catalogue (decision 3) — store-scoped reference tables + the
 * product → brand / product → supplier links. Additive and reversible.
 */
export class CreateBrandsSuppliers1738000000000 implements MigrationInterface {
  name = 'CreateBrandsSuppliers1738000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS brands (
        id          uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        name        varchar NOT NULL,
        store_id    uuid NOT NULL,
        is_active   boolean NOT NULL DEFAULT true,
        created_at  timestamp DEFAULT now() NOT NULL
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_brands_store_name ON brands(store_id, name)`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS suppliers (
        id          uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        name        varchar NOT NULL,
        store_id    uuid NOT NULL,
        email       varchar,
        phone       varchar,
        country     varchar,
        notes       text,
        is_active   boolean NOT NULL DEFAULT true,
        created_at  timestamp DEFAULT now() NOT NULL
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_suppliers_store_name ON suppliers(store_id, name)`);

    await queryRunner.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS brand_id uuid`);
    await queryRunner.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_id uuid`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE products DROP COLUMN IF EXISTS supplier_id`);
    await queryRunner.query(`ALTER TABLE products DROP COLUMN IF EXISTS brand_id`);
    await queryRunner.query(`DROP TABLE IF EXISTS suppliers CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS brands CASCADE`);
  }
}
