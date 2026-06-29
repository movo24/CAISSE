import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * POS-INT-71 — Integration outbox (durable, normalized event stream for
 * Comptamax24 / TimeWin24 / Analytik R). Additive + reversible:
 * CREATE TABLE IF NOT EXISTS, down() drops it. No data loss, no change to
 * existing tables. The caisse never depends on this table being consumed.
 */
export class AddIntegrationOutbox1725000000000 implements MigrationInterface {
  name = 'AddIntegrationOutbox1725000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "integration_events" (
        "id" uuid PRIMARY KEY,
        "type" varchar NOT NULL,
        "aggregate_type" varchar NOT NULL,
        "aggregate_id" varchar NOT NULL,
        "store_id" varchar NOT NULL,
        "organization_id" varchar,
        "terminal_id" varchar,
        "employee_id" varchar,
        "actor_role" varchar,
        "occurred_at" timestamptz NOT NULL,
        "payload" jsonb NOT NULL DEFAULT '{}',
        "schema_version" integer NOT NULL DEFAULT 1,
        "source" varchar NOT NULL DEFAULT 'pos-caisse',
        "status" varchar NOT NULL DEFAULT 'pending',
        "published_at" timestamptz,
        "attempts" integer NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_integration_events_status_created" ON "integration_events" ("status", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_integration_events_aggregate" ON "integration_events" ("aggregate_type", "aggregate_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_integration_events_store_occurred" ON "integration_events" ("store_id", "occurred_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_integration_events_store_occurred"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_integration_events_aggregate"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_integration_events_status_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "integration_events"`);
  }
}
