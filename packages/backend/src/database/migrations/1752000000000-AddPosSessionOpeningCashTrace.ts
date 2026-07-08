import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Opening cash float — declaration + correction trace.
 *
 * The float amount lives in `opening_cash_minor_units` (migration 1749). This
 * adds the PROVENANCE so it is auditable and immutable-by-default:
 * - `opening_cash_set_at`: when the cashier declared the float at open.
 * - `opening_cash_corrected_by` / `_at`: a later correction is manager/admin-
 *   gated and stamped here (old→new also written to the audit chain). A cashier
 *   cannot silently re-declare.
 *
 * Additive + reversible: nullable columns, no default → no write to existing rows.
 */
export class AddPosSessionOpeningCashTrace1752000000000 implements MigrationInterface {
  name = 'AddPosSessionOpeningCashTrace1752000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE pos_sessions ADD COLUMN IF NOT EXISTS opening_cash_set_at timestamp`);
    await queryRunner.query(`ALTER TABLE pos_sessions ADD COLUMN IF NOT EXISTS opening_cash_corrected_by uuid`);
    await queryRunner.query(`ALTER TABLE pos_sessions ADD COLUMN IF NOT EXISTS opening_cash_corrected_at timestamp`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE pos_sessions DROP COLUMN IF EXISTS opening_cash_corrected_at`);
    await queryRunner.query(`ALTER TABLE pos_sessions DROP COLUMN IF EXISTS opening_cash_corrected_by`);
    await queryRunner.query(`ALTER TABLE pos_sessions DROP COLUMN IF EXISTS opening_cash_set_at`);
  }
}
