import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * MODE TEST pilote — colonne `sales.is_test` (100% additive, réversible, sans perte).
 *
 * Autorisée par l'owner en phase pilote pour le contournement de verrou de session
 * (`POS_SESSION_TEST_BYPASS`) : une vente réalisée alors que l'invariant de session
 * est temporairement violé est marquée `is_test = true` afin d'être EXCLUE des
 * rapports/analytics réels (règle 6) et de ne pas contaminer le chiffre.
 *
 * DÉLIBÉRÉMENT HORS de l'empreinte de hash fiscale (v1/v2), exactement comme
 * `session_id` / `terminal_id` / `public_token` : aucune vente validée n'est
 * rehashée, la chaîne d'audit reste intacte. `DEFAULT false` s'applique aux lignes
 * existantes → toutes les ventes historiques restent des ventes RÉELLES.
 *
 * Rollback = DROP de la colonne (aucune donnée réécrite).
 */
export class AddSaleIsTest1775000000000 implements MigrationInterface {
  name = 'AddSaleIsTest1775000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "is_test" boolean NOT NULL DEFAULT false`,
    );
    // Index partiel : les rapports filtrent `is_test = false` ; l'index n'indexe
    // que les (rares) ventes de test pour ne pas alourdir la table réelle.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_sales_is_test" ON "sales" ("is_test") WHERE "is_test" = true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_sales_is_test"`);
    await queryRunner.query(`ALTER TABLE "sales" DROP COLUMN IF EXISTS "is_test"`);
  }
}
