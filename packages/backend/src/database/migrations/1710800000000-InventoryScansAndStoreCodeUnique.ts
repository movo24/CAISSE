import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: Inventory Scans table + store_code unique index
 *
 * 1. Makes store_code unique (with NULL allowed for legacy stores)
 * 2. Creates inventory_scans table for per-store scan tracking
 */
export class InventoryScansAndStoreCodeUnique1710800000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. Unique index on store_code (partial — only non-null values) ──
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_stores_store_code"
      ON "stores" ("store_code")
      WHERE "store_code" IS NOT NULL
    `);

    // ── 2. Create inventory_scans table ──
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "inventory_scans" (
        "id"            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        "store_id"      UUID NOT NULL,
        "store_code"    VARCHAR NOT NULL,
        "employee_id"   UUID NOT NULL,
        "barcode"       VARCHAR NOT NULL,
        "product_id"    UUID,
        "product_name"  VARCHAR,
        "quantity"       INTEGER NOT NULL DEFAULT 1,
        "scan_type"     VARCHAR NOT NULL DEFAULT 'inventory',
        "status"        VARCHAR NOT NULL DEFAULT 'pending',
        "notes"         VARCHAR,
        "session_id"    UUID,
        "created_at"    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

        CONSTRAINT "FK_inv_scan_store"    FOREIGN KEY ("store_id")    REFERENCES "stores"("id")    ON DELETE CASCADE,
        CONSTRAINT "FK_inv_scan_employee" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_inv_scan_product"  FOREIGN KEY ("product_id")  REFERENCES "products"("id")  ON DELETE SET NULL
      )
    `);

    // ── 3. Indices for inventory_scans ──
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_inv_scan_store_created"
      ON "inventory_scans" ("store_id", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_inv_scan_store_barcode"
      ON "inventory_scans" ("store_id", "barcode")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_inv_scan_store_status"
      ON "inventory_scans" ("store_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_inv_scan_session"
      ON "inventory_scans" ("session_id")
      WHERE "session_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "inventory_scans"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_stores_store_code"`);
  }
}
