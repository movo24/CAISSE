import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cash count / écart caisse on POS sessions. Adds the fields needed to compare
 * the EXPECTED cash (opening float + server-derived cash sales of the session)
 * to the COUNTED cash at close, and record the difference — tied to a real
 * session (employee + terminal + store) and to server-side sales.
 *
 * Additive + fully reversible:
 * - Every column is NULLABLE with no default → NO write to existing rows.
 * - A session that never counts cash simply carries NULLs ("not counted"), an
 *   auditable fact — never a fabricated figure.
 * - All amounts are integer centimes (money-as-integer rule).
 */
export class AddPosSessionCashCount1749000000000 implements MigrationInterface {
  name = 'AddPosSessionCashCount1749000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE pos_sessions ADD COLUMN IF NOT EXISTS opening_cash_minor_units integer`);
    await queryRunner.query(`ALTER TABLE pos_sessions ADD COLUMN IF NOT EXISTS cash_sales_minor_units integer`);
    await queryRunner.query(`ALTER TABLE pos_sessions ADD COLUMN IF NOT EXISTS expected_cash_minor_units integer`);
    await queryRunner.query(`ALTER TABLE pos_sessions ADD COLUMN IF NOT EXISTS counted_cash_minor_units integer`);
    await queryRunner.query(`ALTER TABLE pos_sessions ADD COLUMN IF NOT EXISTS cash_difference_minor_units integer`);
    await queryRunner.query(`ALTER TABLE pos_sessions ADD COLUMN IF NOT EXISTS cash_counted_at timestamp`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE pos_sessions DROP COLUMN IF EXISTS cash_counted_at`);
    await queryRunner.query(`ALTER TABLE pos_sessions DROP COLUMN IF EXISTS cash_difference_minor_units`);
    await queryRunner.query(`ALTER TABLE pos_sessions DROP COLUMN IF EXISTS counted_cash_minor_units`);
    await queryRunner.query(`ALTER TABLE pos_sessions DROP COLUMN IF EXISTS expected_cash_minor_units`);
    await queryRunner.query(`ALTER TABLE pos_sessions DROP COLUMN IF EXISTS cash_sales_minor_units`);
    await queryRunner.query(`ALTER TABLE pos_sessions DROP COLUMN IF EXISTS opening_cash_minor_units`);
  }
}
