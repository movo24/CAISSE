import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Étage 0 extension (GO'd): analytics.store_daily gains discount_total_minor —
 * the source (`sales.discount_total_minor_units`) exists; the projection now
 * derives it (INV-4: store the RAW figure; the discount_rate rule computes the
 * ratio, symmetric with void_rate). Additive, greenfield-safe, reversible.
 * Also seeds the discount_rate alert default config (data, not wiring).
 */
export class AddStoreDailyDiscount1725000000000 implements MigrationInterface {
  name = 'AddStoreDailyDiscount1725000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE analytics.store_daily ADD COLUMN IF NOT EXISTS discount_total_minor integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(`
      INSERT INTO analytics.alert_config (id, store_id, rule, params, is_active) VALUES
        (uuid_generate_v4(), NULL, 'discount_rate', '{"warning_rate": 0.10, "critical_rate": 0.20, "min_tx": 10}', true)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM analytics.alert_config WHERE rule = 'discount_rate' AND store_id IS NULL`);
    await queryRunner.query(`ALTER TABLE analytics.store_daily DROP COLUMN IF EXISTS discount_total_minor`);
  }
}
