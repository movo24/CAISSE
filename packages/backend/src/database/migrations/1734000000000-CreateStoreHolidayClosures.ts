import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Schedule chantier, commit 5 — analytics.store_holiday_closures: the holidays
 * on which THIS store closes. Owner selection (BackOffice checklist): a row
 * means "closed on that holiday"; NO seed — no store closes by default
 * (ratified: "sélection owner, pas tous par défaut"). holiday_key references
 * the deterministic French-holiday keys (french-holidays.util).
 */
export class CreateStoreHolidayClosures1734000000000 implements MigrationInterface {
  name = 'CreateStoreHolidayClosures1734000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS analytics.store_holiday_closures (
        id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        store_id     uuid NOT NULL,
        holiday_key  varchar(40) NOT NULL,
        updated_at   timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_holiday_closures_store_key ON analytics.store_holiday_closures(store_id, holiday_key)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS analytics.store_holiday_closures`);
  }
}
