import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A5 (ratified) — analytics.store_product_daily: per-(store, business_day, product)
 * sales projection (qty + revenue), aggregated from the COMPLETED sales' line items
 * by the étage-0 refresh job. Margin/cost are OUT of V1 (ratified) — revenue only.
 *
 * Additive étage 0: same schema, same writers-only discipline (INV-2), same
 * `store_id` scope key (INV-5) and `computed_at` freshness datum as the other
 * projections. Columns are exactly the ratified tuple + computed_at.
 */
export class CreateStoreProductDaily1731000000000 implements MigrationInterface {
  name = 'CreateStoreProductDaily1731000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS analytics.store_product_daily (
        id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        store_id       uuid NOT NULL,
        business_day   date NOT NULL,
        product_id     uuid NOT NULL,
        qty            integer NOT NULL DEFAULT 0,
        revenue_minor  integer NOT NULL DEFAULT 0,
        computed_at    timestamptz NOT NULL
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_store_product_daily_store_day_product ON analytics.store_product_daily(store_id, business_day, product_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_store_product_daily_store ON analytics.store_product_daily(store_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS analytics.store_product_daily`);
  }
}
