import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P327 (cycle K) — variantes option A (PRODUCT_VARIANTS_DECISION.md, GO reçu).
 *
 * Additive & réversible :
 *  - products : + parent_product_id (uuid NULL, auto-référence SANS FK),
 *               + variant_label (varchar NULL), + brand (varchar NULL),
 *               + supplier_id (uuid NULL)
 *  - suppliers : nouvelle table minimale (tenant-scoped, nom unique par magasin)
 *  - index : products(store_id, parent_product_id) pour le regroupement.
 * Lignes existantes : toutes NULL (produits simples) — zéro changement caisse.
 * ⚠️ NON jouée sur la base cible depuis le sandbox — file GATE 2 (avec 1725/1726).
 */
export class AddProductVariantsAndSuppliers1727000000000 implements MigrationInterface {
  name = 'AddProductVariantsAndSuppliers1727000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "parent_product_id" uuid NULL`);
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "variant_label" varchar(100) NULL`);
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "brand" varchar(150) NULL`);
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "supplier_id" uuid NULL`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_products_store_parent" ON "products" ("store_id", "parent_product_id")`,
    );
    // Idempotence via hasTable (pg-mem ne parse pas CREATE TABLE IF NOT EXISTS
    // avec contraintes de colonnes). PK/DEFAULT séparés = SQL PG standard ;
    // TypeORM génère de toute façon les uuid côté client.
    if (!(await queryRunner.hasTable('suppliers'))) {
      await queryRunner.query(`
        CREATE TABLE "suppliers" (
          "id" uuid NOT NULL,
          "store_id" character varying NOT NULL,
          "name" character varying(200) NOT NULL,
          "contact" character varying(300),
          "notes" character varying(500),
          "is_active" boolean NOT NULL DEFAULT true,
          "created_at" TIMESTAMP NOT NULL DEFAULT now(),
          CONSTRAINT "PK_suppliers_id" PRIMARY KEY ("id")
        )
      `);
      await queryRunner.query(
        `ALTER TABLE "suppliers" ALTER COLUMN "id" SET DEFAULT uuid_generate_v4()`,
      );
    }
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_suppliers_store" ON "suppliers" ("store_id")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_suppliers_store_name" ON "suppliers" ("store_id", "name")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_suppliers_store_name"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_suppliers_store"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "suppliers"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_products_store_parent"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "supplier_id"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "brand"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "variant_label"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "parent_product_id"`);
  }
}
