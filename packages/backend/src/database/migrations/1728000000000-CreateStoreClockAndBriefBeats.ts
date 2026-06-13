import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ratified (post-rebase GO): store wall-clock policy as a SINGLE datum + brief
 * beats.
 *
 * - analytics.store_clock: ONE source for the ai-brief beats, the
 *   store_closed_late threshold and (future) the business-day definition.
 *   Seeded UTC stand-in (timezone 'Etc/UTC', beats [10, 15], close 20 —
 *   ≈ 12h/17h/22h Paris summer; DST drift documented on the entity).
 * - analytics.briefs: + beat column; uniqueness moves to (scope_key,
 *   business_day, beat) — a brief regenerates only at a beat, stable in between
 *   (structural, not advisory).
 * - SINGLE-SOURCE ENFORCEMENT: the store_closed_late alert_config default
 *   (close_hour_utc) is DELETED — the rule now reads store_clock. Two configs for
 *   one wall-clock value would be the D-ALERTS-1 trap in duplicate.
 */
export class CreateStoreClockAndBriefBeats1728000000000 implements MigrationInterface {
  name = 'CreateStoreClockAndBriefBeats1728000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS analytics.store_clock (
        id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        store_id          uuid,
        timezone          varchar NOT NULL DEFAULT 'Etc/UTC',
        brief_beat_hours  jsonb NOT NULL,
        close_hour        integer NOT NULL,
        is_active         boolean NOT NULL DEFAULT true
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_store_clock_store ON analytics.store_clock(store_id)`,
    );
    await queryRunner.query(`
      INSERT INTO analytics.store_clock (id, store_id, timezone, brief_beat_hours, close_hour, is_active)
      VALUES (uuid_generate_v4(), NULL, 'Etc/UTC', '[10, 15]', 20, true)
    `);

    await queryRunner.query(`ALTER TABLE analytics.briefs ADD COLUMN IF NOT EXISTS beat integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`DROP INDEX IF EXISTS analytics.uq_briefs_scope_day`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_briefs_scope_day_beat ON analytics.briefs(scope_key, business_day, beat)`,
    );

    // single-source enforcement: the rule reads store_clock now.
    await queryRunner.query(`DELETE FROM analytics.alert_config WHERE rule = 'store_closed_late' AND store_id IS NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO analytics.alert_config (id, store_id, rule, params, is_active)
      VALUES (uuid_generate_v4(), NULL, 'store_closed_late', '{"close_hour_utc": 21}', true)
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS analytics.uq_briefs_scope_day_beat`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_briefs_scope_day ON analytics.briefs(scope_key, business_day)`,
    );
    await queryRunner.query(`ALTER TABLE analytics.briefs DROP COLUMN IF EXISTS beat`);
    await queryRunner.query(`DROP TABLE IF EXISTS analytics.store_clock`);
  }
}
