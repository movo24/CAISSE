import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add performance indexes identified during production hardening audit.
 *
 * All indexes use IF NOT EXISTS to be idempotent — safe to re-run.
 * Naming convention: IDX_<table>_<columns>
 */
export class HardeningIndexes1710500000000 implements MigrationInterface {
  name = 'HardeningIndexes1710500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Products: fast lookup by store + active status (listing, stock alerts)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_products_store_id_is_active"
      ON "products" ("store_id", "is_active")
    `);

    // Products: unique EAN per store (prevent duplicate barcodes within a store)
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_products_ean_store_id"
      ON "products" ("ean", "store_id")
    `);

    // Promo rules: fast lookup by store + active status (promotion engine)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_promo_rules_store_id_is_active"
      ON "promo_rules" ("store_id", "is_active")
    `);

    // Jackpot configs: fast lookup by store + active status
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_jackpot_configs_store_id_is_active"
      ON "jackpot_configs" ("store_id", "is_active")
    `);

    // Sale payments: fast join from sale → payments
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_sale_payments_sale_id"
      ON "sale_payments" ("sale_id")
    `);

    // Price history: fast lookup by product + time range (reports, audit trail)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_price_history_product_id_changed_at"
      ON "price_history" ("product_id", "changed_at")
    `);

    // Product categories: fast lookup by store (category listing)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_product_categories_store_id"
      ON "product_categories" ("store_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_products_store_id_is_active"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_products_ean_store_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_promo_rules_store_id_is_active"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_jackpot_configs_store_id_is_active"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_sale_payments_sale_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_price_history_product_id_changed_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_product_categories_store_id"`);
  }
}
