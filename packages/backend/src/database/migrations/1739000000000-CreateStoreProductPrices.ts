import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-store price override (decision 4) — store_product_prices. The product price
 * is the default; an active override (optional window) wins at sale time. One
 * override per product. Additive + reversible.
 */
export class CreateStoreProductPrices1739000000000 implements MigrationInterface {
  name = 'CreateStoreProductPrices1739000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS store_product_prices (
        id                 uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        store_id           uuid NOT NULL,
        product_id         uuid NOT NULL,
        price_minor_units  integer NOT NULL,
        is_active          boolean NOT NULL DEFAULT true,
        starts_at          timestamp,
        ends_at            timestamp,
        created_at         timestamp DEFAULT now() NOT NULL,
        updated_at         timestamp DEFAULT now() NOT NULL
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_store_product_prices_product ON store_product_prices(product_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_store_product_prices_store ON store_product_prices(store_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS store_product_prices CASCADE`);
  }
}
