import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * (1b) binding — operator attribution side-table (option (i), ratified).
 *
 * A dedicated, manifestly non-fiscal table. The three hashed fiscal tables
 * (sales, credit_notes, fiscal_journal) are NOT touched — non-authority is
 * structural, not asserted. Insert-only at the application level; written in
 * the same transaction as its event.
 *
 * Additive: new table only. Prod fiscal tables unchanged.
 */
export class AddOperatorAttribution1721000000000 implements MigrationInterface {
  name = 'AddOperatorAttribution1721000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS operator_attribution (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        event_type          varchar NOT NULL,
        event_id            uuid NOT NULL,
        store_id            varchar NOT NULL,
        session_operator_id varchar,
        session_terminal_id varchar,
        attribution_source  varchar NOT NULL,
        created_at          timestamptz NOT NULL DEFAULT now()
      )
    `);

    // One attribution row per event (idempotent observation, no duplicates).
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_operator_attribution_event
        ON operator_attribution(event_type, event_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_operator_attribution_store_source
        ON operator_attribution(store_id, attribution_source)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_operator_attribution_store_source`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_operator_attribution_event`);
    await queryRunner.query(`DROP TABLE IF EXISTS operator_attribution`);
  }
}
