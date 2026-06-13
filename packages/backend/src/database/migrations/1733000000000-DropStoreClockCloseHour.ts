import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Schedule chantier, commit 3 — store_clock.close_hour is REPLACED by the
 * schedule resolver (store_weekly_hours, seeded from this very column by 1732).
 * One source per datum: the column is DROPPED, not left as a second living
 * close-hour. store_clock keeps what remains ITS datum: the IANA timezone and
 * the intraday brief beats.
 */
export class DropStoreClockCloseHour1733000000000 implements MigrationInterface {
  name = 'DropStoreClockCloseHour1733000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE analytics.store_clock DROP COLUMN IF EXISTS close_hour`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE analytics.store_clock ADD COLUMN IF NOT EXISTS close_hour integer NOT NULL DEFAULT 20`,
    );
  }
}
