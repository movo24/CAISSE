import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Employee System Score — ledger de faits POS probants + agrégats + règles.
 *
 * 100 % additif : trois tables neuves, aucune colonne modifiée sur l'existant,
 * aucun risque pour les ventes/paiements/stock. Le score est recomputable ;
 * l'audit_entry reste la source immuable des faits.
 */
export class AddEmployeeSystemScore1747000000000 implements MigrationInterface {
  name = 'AddEmployeeSystemScore1747000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── employee_score_events ──
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "employee_score_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "employee_id" character varying NOT NULL,
        "store_id" character varying NOT NULL,
        "terminal_id" character varying,
        "session_id" uuid,
        "event_type" character varying NOT NULL,
        "category" character varying NOT NULL DEFAULT 'info',
        "severity" character varying NOT NULL DEFAULT 'info',
        "points_delta" integer NOT NULL DEFAULT 0,
        "reason" character varying,
        "metadata_json" jsonb,
        "created_by" character varying,
        "source" character varying NOT NULL DEFAULT 'pos',
        "rule_version" integer NOT NULL DEFAULT 1,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_employee_score_events" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ese_employee_created" ON "employee_score_events" ("employee_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ese_store_created" ON "employee_score_events" ("store_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ese_employee_type_created" ON "employee_score_events" ("employee_id", "event_type", "created_at")`,
    );

    // ── employee_score_rules ──
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "employee_score_rules" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "rule_code" character varying NOT NULL,
        "event_type" character varying NOT NULL,
        "category" character varying NOT NULL,
        "label" character varying NOT NULL,
        "points_delta" integer NOT NULL DEFAULT 0,
        "severity" character varying NOT NULL DEFAULT 'info',
        "max_daily_penalty" integer NOT NULL DEFAULT 0,
        "alert" boolean NOT NULL DEFAULT false,
        "enabled" boolean NOT NULL DEFAULT true,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_employee_score_rules" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_esr_event_type" UNIQUE ("event_type")
      )
    `);

    // ── employee_score_daily ──
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "employee_score_daily" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "employee_id" character varying NOT NULL,
        "store_id" character varying NOT NULL,
        "score_date" date NOT NULL,
        "score_total" integer NOT NULL DEFAULT 100,
        "score_color" character varying NOT NULL DEFAULT 'green',
        "session_score" integer NOT NULL DEFAULT 25,
        "cash_score" integer NOT NULL DEFAULT 25,
        "procedure_score" integer NOT NULL DEFAULT 20,
        "inventory_score" integer NOT NULL DEFAULT 10,
        "schedule_score" integer NOT NULL DEFAULT 10,
        "regularity_score" integer NOT NULL DEFAULT 10,
        "event_count" integer NOT NULL DEFAULT 0,
        "calculated_at" TIMESTAMP,
        "rule_version" integer NOT NULL DEFAULT 1,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_employee_score_daily" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_esd_employee_date" UNIQUE ("employee_id", "score_date")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_esd_store_date" ON "employee_score_daily" ("store_id", "score_date")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "employee_score_daily"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "employee_score_rules"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "employee_score_events"`);
  }
}
