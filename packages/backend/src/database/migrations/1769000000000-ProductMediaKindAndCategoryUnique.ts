import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P-B — images (M-C) + intégrité catégories (M-B). ADDITIF + RÉVERSIBLE.
 *
 * M-C : `product_media.kind` (main|front|back|detail|other) + index unique PARTIEL
 *   garantissant AU PLUS une image principale par produit. Backfill non destructif :
 *   la première image existante (sort_order/created_at) de chaque produit devient `main`
 *   (conforme au comportement UI actuel « la première image est la principale »).
 *
 * M-B : index unique catégorie par (magasin, parent, nom insensible à la casse) — en
 *   RENFORT de l'unicité déjà garantie applicativement (createCategory/updateCategory).
 *   Racine gérée via COALESCE(parent_id,'') ; casse gérée via lower(name), cohérent
 *   avec le dédoublonnage applicatif. Aucune colonne `level` (profondeur dérivée de
 *   parent_id — arbre réellement illimité).
 */
export class ProductMediaKindAndCategoryUnique1769000000000 implements MigrationInterface {
  name = 'ProductMediaKindAndCategoryUnique1769000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── M-C : kind d'image ──
    await queryRunner.query(
      `ALTER TABLE "product_media" ADD COLUMN IF NOT EXISTS "kind" varchar(12) NOT NULL DEFAULT 'other'`,
    );
    // Backfill : la première image de chaque produit devient principale.
    await queryRunner.query(`
      UPDATE "product_media" SET "kind" = 'main'
      WHERE "id" IN (
        SELECT DISTINCT ON ("product_id") "id"
        FROM "product_media"
        ORDER BY "product_id", "sort_order" ASC, "created_at" ASC
      )
    `);
    // Au plus UNE principale par produit.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_product_media_main" ON "product_media" ("product_id") WHERE "kind" = 'main'`,
    );

    // ── M-B : unicité catégorie (magasin, parent, nom) insensible à la casse ──
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_product_categories_store_parent_name" ` +
        `ON "product_categories" ("store_id", COALESCE("parent_id", ''), lower("name"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_product_categories_store_parent_name"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_product_media_main"`);
    await queryRunner.query(`ALTER TABLE "product_media" DROP COLUMN IF EXISTS "kind"`);
  }
}
