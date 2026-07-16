import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P-D / M-G — vues & filtres enregistrables côté SERVEUR (spec bd4179b §M-G).
 * ADDITIF + RÉVERSIBLE. Remplace le stockage localStorage (Lot J) par une
 * persistance par employé, portable entre postes. `config` = snapshot opaque
 * de la vue (colonnes, tri, filtres) — jsonb, non interprété par le serveur.
 *
 * Numéro 1770 : vérifié libre sur toutes les refs (cf. docs/MIGRATIONS_LEDGER.md).
 */
export class CreateUserSavedFilters1770000000000 implements MigrationInterface {
  name = 'CreateUserSavedFilters1770000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_saved_filters" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "employee_id" uuid NOT NULL,
        "page" varchar(30) NOT NULL,
        "name" varchar(60) NOT NULL,
        "config" jsonb NOT NULL DEFAULT '{}',
        "created_at" timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_user_saved_filters_owner" ON "user_saved_filters" ("employee_id", "page")`,
    );
    // Un nom de vue unique par employé et par page (le ré-enregistrement écrase).
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_saved_filters_name" ON "user_saved_filters" ("employee_id", "page", "name")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_user_saved_filters_name"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_user_saved_filters_owner"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_saved_filters"`);
  }
}
