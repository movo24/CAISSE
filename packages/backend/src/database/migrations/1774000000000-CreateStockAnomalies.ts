import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Chantier 4 — stock négatif autorisé : anomalies de stock.
 *
 * Une vente en caisse n'est JAMAIS bloquée par le stock informatique. Quand une
 * vente finalisée fait passer un stock en négatif, elle enregistre UNE anomalie
 * (une ligne par vente, tous produits concernés regroupés en JSONB) à contrôler
 * par le responsable magasin / le Central.
 *
 * 100% additif et réversible : nouvelle table uniquement, aucune colonne
 * existante modifiée, aucune donnée réécrite, aucune surface fiscale (hash de
 * vente, fiscal_journal, credit_notes, audit) touchée. Rollback = DROP TABLE.
 *
 * `sale_id` UNIQUE = anti-doublon (replay réseau / resynchronisation offline).
 */
export class CreateStockAnomalies1774000000000 implements MigrationInterface {
  name = 'CreateStockAnomalies1774000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "stock_anomalies" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "store_id" character varying NOT NULL,
        "sale_id" uuid NOT NULL,
        "ticket_number" character varying NOT NULL,
        "terminal_id" character varying,
        "session_id" uuid,
        "employee_id" character varying NOT NULL,
        "employee_name" character varying,
        "occurred_at" timestamptz NOT NULL,
        "items" jsonb NOT NULL,
        "status" character varying NOT NULL DEFAULT 'a_controler',
        "controlled_by" character varying,
        "controlled_by_name" character varying,
        "controlled_at" timestamptz,
        "justification" text,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "uq_stock_anomalies_sale" UNIQUE ("sale_id"),
        CONSTRAINT "chk_stock_anomalies_status" CHECK ("status" IN ('a_controler', 'controlee'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_stock_anomalies_store_status" ON "stock_anomalies" ("store_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_stock_anomalies_store_occurred" ON "stock_anomalies" ("store_id", "occurred_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "stock_anomalies"`);
  }
}
