import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Enrôlement machine POS (Partie B).
 *
 * 1. `pos_machines` : identité matérielle déclarée par la caisse et validée par
 *    le back-office (pending → approved / rejected / revoked). Une ligne par
 *    `machine_id`.
 * 2. `stores.enrollment_enforced` : interrupteur d'application de l'enrôlement,
 *    **défaut `false`**. Additif — déployer cette migration ne bloque AUCUNE
 *    caisse existante ; un magasin active l'enrôlement consciemment.
 *
 * 100 % additive, réversible. Aucune donnée existante réécrite. Ne touche ni la
 * chaîne de hash, ni les ventes, ni le journal fiscal.
 */
export class AddPosMachineEnrollment1756000000000 implements MigrationInterface {
  name = 'AddPosMachineEnrollment1756000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pos_machines" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "machine_id" character varying NOT NULL,
        "store_id" character varying NOT NULL,
        "terminal_label" character varying NOT NULL,
        "machine_name" character varying,
        "platform" character varying,
        "app_version" character varying,
        "status" character varying NOT NULL DEFAULT 'pending',
        "requested_by" character varying,
        "decided_by" character varying,
        "decided_at" TIMESTAMP,
        "decision_reason" character varying,
        "last_seen_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pos_machines" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_pos_machines_machine_id" UNIQUE ("machine_id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_pos_machines_store_status" ON "pos_machines" ("store_id", "status")`,
    );

    await queryRunner.query(
      `ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "enrollment_enforced" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "stores" DROP COLUMN IF EXISTS "enrollment_enforced"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "pos_machines"`);
  }
}
