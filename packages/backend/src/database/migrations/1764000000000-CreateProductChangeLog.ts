import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Catalogue — Lot D : journal des modifications de la fiche produit (append-only).
 * ADDITIF + RÉVERSIBLE. Trace champ par champ (nom, prix vente, prix d'achat, TVA,
 * catégorie, marque, fournisseur, statut…) : couvre l'historique complet des prix
 * d'achat, l'historique fournisseur (supplier_id) et l'historique des modifications
 * de la fiche. Complète `price_history` (prix de vente) qui reste inchangé.
 */
export class CreateProductChangeLog1764000000000 implements MigrationInterface {
  name = 'CreateProductChangeLog1764000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "product_change_log" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "product_id" uuid NOT NULL,
        "store_id" uuid NOT NULL,
        "field" varchar(60) NOT NULL,
        "old_value" text,
        "new_value" text,
        "changed_by" varchar(100),
        "changed_by_role" varchar(30),
        "created_at" timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_product_change_log_product" ON "product_change_log" ("product_id", "created_at")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "product_change_log"`);
  }
}
