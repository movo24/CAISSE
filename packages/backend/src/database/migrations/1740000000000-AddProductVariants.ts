import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Variants / SKU (decision 5) — modelled as PRODUCT ROWS with a parent link, so a
 * variant inherits its own ean / price / stock / active / per-store-override /
 * brand for free and the fiscal sale path needs NO change (a variant's barcode is
 * just another product EAN). A simple product keeps parent_product_id = NULL —
 * existing products are untouched.
 *
 * - parent_product_id : the parent product (NULL for simple/top-level products)
 * - sku               : optional per-variant SKU (unique per store when present)
 * - variant_name      : the variant label, e.g. "Rouge / M"
 */
export class AddProductVariants1740000000000 implements MigrationInterface {
  name = 'AddProductVariants1740000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS parent_product_id uuid`);
    await queryRunner.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS sku varchar`);
    await queryRunner.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS variant_name varchar`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_products_parent ON products(parent_product_id)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_products_store_sku ON products(store_id, sku) WHERE sku IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uq_products_store_sku`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_products_parent`);
    await queryRunner.query(`ALTER TABLE products DROP COLUMN IF EXISTS variant_name`);
    await queryRunner.query(`ALTER TABLE products DROP COLUMN IF EXISTS sku`);
    await queryRunner.query(`ALTER TABLE products DROP COLUMN IF EXISTS parent_product_id`);
  }
}
