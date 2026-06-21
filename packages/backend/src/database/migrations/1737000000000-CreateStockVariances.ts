import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Inventory reconciliation (decision 7) — stock_variances: the human-intervention
 * queue for shortages ≥ the threshold (default 20%). A flagged variance is never
 * auto-corrected; a manager confirms the real quantity with a mandatory reason and
 * validates the correction. Every transition is audited.
 */
export class CreateStockVariances1737000000000 implements MigrationInterface {
  name = 'CreateStockVariances1737000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS stock_variances (
        id               uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        store_id         uuid NOT NULL,
        product_id       uuid NOT NULL,
        theoretical_qty  integer NOT NULL,
        physical_qty     integer NOT NULL,
        variance_pct     numeric(6,2) NOT NULL,
        status           varchar(20) NOT NULL DEFAULT 'pending_review',
        reason           varchar(30),
        detected_by      uuid NOT NULL,
        reviewed_by      uuid,
        created_at       timestamp DEFAULT now() NOT NULL,
        reviewed_at      timestamp
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_stock_variances_store_status ON stock_variances(store_id, status)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS stock_variances CASCADE`);
  }
}
