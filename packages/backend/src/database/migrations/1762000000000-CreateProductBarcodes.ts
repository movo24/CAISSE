import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Catalogue — Lot A : codes-barres multiples par produit (EAN / UPC / GTIN / autre).
 * ADDITIF + RÉVERSIBLE. Le `products.ean` reste le code principal historique ;
 * cette table porte les codes secondaires. Unicité (store, barcode) — un code
 * pointe vers un seul produit par magasin.
 */
export class CreateProductBarcodes1762000000000 implements MigrationInterface {
  name = 'CreateProductBarcodes1762000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "product_barcodes" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "product_id" uuid NOT NULL,
        "store_id" uuid NOT NULL,
        "barcode" varchar(64) NOT NULL,
        "type" varchar(12) NOT NULL DEFAULT 'ean',
        "is_primary" boolean NOT NULL DEFAULT false,
        "created_at" timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uq_product_barcodes_store_code" ON "product_barcodes" ("store_id", "barcode")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_product_barcodes_product" ON "product_barcodes" ("product_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "product_barcodes"`);
  }
}
