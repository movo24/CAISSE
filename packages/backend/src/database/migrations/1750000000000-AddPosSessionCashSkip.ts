import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * "Fermeture sans comptage" encadrée. A cashier may still close without a cash
 * count (technical resilience), but an EXPLICIT skip must carry a reason so it
 * is auditable, visible to managers and scoreable — never a silent escape.
 *
 * Additive + reversible: two nullable columns, no default → no write to
 * existing rows. Silent closes (logout / abandon) keep both NULL.
 */
export class AddPosSessionCashSkip1750000000000 implements MigrationInterface {
  name = 'AddPosSessionCashSkip1750000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE pos_sessions ADD COLUMN IF NOT EXISTS cash_count_skipped_reason varchar`);
    await queryRunner.query(`ALTER TABLE pos_sessions ADD COLUMN IF NOT EXISTS cash_count_skipped_at timestamp`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE pos_sessions DROP COLUMN IF EXISTS cash_count_skipped_at`);
    await queryRunner.query(`ALTER TABLE pos_sessions DROP COLUMN IF EXISTS cash_count_skipped_reason`);
  }
}
