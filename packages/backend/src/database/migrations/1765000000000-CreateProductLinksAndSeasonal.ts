import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Catalogue — Lot E : produits liés (complémentaires / ventes croisées /
 * substitution) + produits saisonniers. ADDITIF + RÉVERSIBLE.
 */
export class CreateProductLinksAndSeasonal1765000000000 implements MigrationInterface {
  name = 'CreateProductLinksAndSeasonal1765000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "product_links" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "product_id" uuid NOT NULL,
        "store_id" uuid NOT NULL,
        "linked_product_id" uuid NOT NULL,
        "link_type" varchar(16) NOT NULL DEFAULT 'complementary',
        "created_at" timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uq_product_links_triple" ON "product_links" ("product_id", "linked_product_id", "link_type")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_product_links_product" ON "product_links" ("product_id")`);

    // Saisonnalité (fenêtre par mois, récurrente chaque année).
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "is_seasonal" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "season_start_month" integer`);
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "season_end_month" integer`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "season_end_month"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "season_start_month"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "is_seasonal"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "product_links"`);
  }
}
