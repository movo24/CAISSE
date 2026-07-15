import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Catalogue — Lot 4 : galerie d'images + documents produit (URLs externes).
 * 100% ADDITIF et RÉVERSIBLE. Aucune donnée binaire en base (décision owner :
 * URLs externes uniquement) — pas de dépendance à un stockage objet.
 */
export class CreateProductMediaAndDocuments1761000000000 implements MigrationInterface {
  name = 'CreateProductMediaAndDocuments1761000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "product_media" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "product_id" uuid NOT NULL,
        "store_id" uuid NOT NULL,
        "url" text NOT NULL,
        "sort_order" integer NOT NULL DEFAULT 0,
        "created_at" timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_product_media_product" ON "product_media" ("product_id")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "product_documents" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "product_id" uuid NOT NULL,
        "store_id" uuid NOT NULL,
        "name" varchar(200) NOT NULL,
        "url" text NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_product_documents_product" ON "product_documents" ("product_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "product_documents"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "product_media"`);
  }
}
