import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sale → POS session binding. Adds `session_id` (pos_sessions.id) and
 * `terminal_id` (X-Terminal-Id) to `sales`, resolved server-side from the
 * terminal's active session at sale creation.
 *
 * Additive + fully reversible:
 * - Both columns are NULLABLE with no default → NO write to existing rows, no
 *   rewrite of validated sale history (NF525 immutability preserved).
 * - Legacy sales keep `NULL` = "session unknown" (an auditable fact, never a
 *   fabricated/backfilled binding).
 * - The columns are OUTSIDE the fiscal hash fingerprint (v1/v2 allowlist in
 *   sales.service + fiscal-verify), so no ticket is rehashed and every existing
 *   hash still verifies.
 * - A non-unique index on `session_id` supports "all sales of a session" reads
 *   (cash-count derivation) without constraining history.
 */
export class AddSaleSessionBinding1748000000000 implements MigrationInterface {
  name = 'AddSaleSessionBinding1748000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE sales ADD COLUMN IF NOT EXISTS session_id uuid`);
    await queryRunner.query(`ALTER TABLE sales ADD COLUMN IF NOT EXISTS terminal_id varchar`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_sales_session_id ON sales (session_id) WHERE session_id IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_sales_session_id`);
    await queryRunner.query(`ALTER TABLE sales DROP COLUMN IF EXISTS terminal_id`);
    await queryRunner.query(`ALTER TABLE sales DROP COLUMN IF EXISTS session_id`);
  }
}
