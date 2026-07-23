import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Catalogue — Lot B : plusieurs fournisseurs par produit (fournisseur principal,
 * référence fournisseur, prix d'achat, devise, délai, MOQ, Incoterm).
 * ADDITIF + RÉVERSIBLE. Le products.supplier_id (fournisseur principal simple,
 * Lot 2) reste ; cette table porte le détail multi-fournisseur.
 */
export class CreateProductSuppliers1763000000000 implements MigrationInterface {
  name = 'CreateProductSuppliers1763000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "product_suppliers" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "product_id" uuid NOT NULL,
        "store_id" uuid NOT NULL,
        "supplier_id" uuid NOT NULL,
        "is_primary" boolean NOT NULL DEFAULT false,
        "supplier_ref" varchar(100),
        "purchase_price_minor_units" integer,
        "currency_code" varchar(3) NOT NULL DEFAULT 'EUR',
        "lead_time_days" integer,
        "min_order_quantity" integer,
        "incoterm" varchar(12),
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uq_product_suppliers_product_supplier" ON "product_suppliers" ("product_id", "supplier_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_product_suppliers_product" ON "product_suppliers" ("product_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "product_suppliers"`);
  }
}
