import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * MIGRATION: Remove RH tables + Add POS sessions + Add employee snapshots to sales
 *
 * This migration enforces the strict separation:
 * - TimeWin24 = master RH data (employees, pointage, payroll, planning)
 * - POS CAISSE = commerce only (sales, products, stock, sessions)
 *
 * RH tables are DROPPED because:
 * - Employee data now lives exclusively in TimeWin24
 * - Pointage is managed by TimeWin24 attendance API
 * - Payroll computation moved to TimeWin24
 * - Staffing analysis moved to TimeWin24 AI engine
 *
 * New additions:
 * - pos_sessions: tracks active register sessions with TimeWin24 employee snapshots
 * - Employee snapshot columns on sales: preserves historical attribution
 */
export class RemoveRHAddPOSSessions1710900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ──────────────────────────────────────────────
    // 1. Add employee snapshot columns to sales
    // ──────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "sales"
        ADD COLUMN IF NOT EXISTS "employee_name_snapshot" VARCHAR,
        ADD COLUMN IF NOT EXISTS "employee_role_snapshot" VARCHAR,
        ADD COLUMN IF NOT EXISTS "employee_max_discount_snapshot" DECIMAL;
    `);

    // Backfill existing sales with employee data before dropping
    await queryRunner.query(`
      UPDATE "sales" s
      SET
        "employee_name_snapshot" = COALESCE(e."first_name" || ' ' || e."last_name", 'Unknown'),
        "employee_role_snapshot" = COALESCE(e."role", 'cashier'),
        "employee_max_discount_snapshot" = COALESCE(e."max_discount_percent", 5)
      FROM "employees" e
      WHERE s."employee_id" = e."id"::text
        AND s."employee_name_snapshot" IS NULL;
    `);

    // ──────────────────────────────────────────────
    // 2. Create pos_sessions table
    // ──────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pos_sessions" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "store_id" VARCHAR NOT NULL,
        "employee_id" VARCHAR NOT NULL,
        "employee_name" VARCHAR NOT NULL,
        "employee_role" VARCHAR NOT NULL,
        "max_discount" DECIMAL DEFAULT 0,
        "permissions" JSONB DEFAULT '{}',
        "timewin_session_token" VARCHAR,
        "is_active" BOOLEAN DEFAULT true,
        "opened_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        "closed_at" TIMESTAMP WITH TIME ZONE,
        "offline_mode" BOOLEAN DEFAULT false
      );

      CREATE INDEX IF NOT EXISTS "idx_pos_sessions_store_active"
        ON "pos_sessions" ("store_id", "is_active");
      CREATE INDEX IF NOT EXISTS "idx_pos_sessions_employee_active"
        ON "pos_sessions" ("employee_id", "is_active");
    `);

    // ──────────────────────────────────────────────
    // 3. Drop RH tables (order matters for FK constraints)
    // ──────────────────────────────────────────────
    await queryRunner.query(`DROP TABLE IF EXISTS "payroll_configs" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "staffing_snapshots" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "pointage_entries" CASCADE;`);

    // Remove FK constraint from sales to employees before dropping
    await queryRunner.query(`
      ALTER TABLE "sales" DROP CONSTRAINT IF EXISTS "FK_sales_employee";
      ALTER TABLE "audit_entries" DROP CONSTRAINT IF EXISTS "FK_audit_employee";
    `);

    // Drop employees table
    await queryRunner.query(`DROP TABLE IF EXISTS "employees" CASCADE;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Recreate employees table (minimal — data is lost)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "employees" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "store_id" VARCHAR NOT NULL,
        "first_name" VARCHAR NOT NULL,
        "last_name" VARCHAR NOT NULL,
        "email" VARCHAR NOT NULL,
        "pin_hash" VARCHAR NOT NULL,
        "qr_code" VARCHAR UNIQUE NOT NULL,
        "role" VARCHAR DEFAULT 'cashier',
        "max_discount_percent" DECIMAL DEFAULT 5,
        "is_active" BOOLEAN DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Recreate other RH tables
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pointage_entries" (
        "id" VARCHAR PRIMARY KEY,
        "store_id" VARCHAR NOT NULL,
        "employee_id" VARCHAR NOT NULL,
        "employee_name" VARCHAR NOT NULL,
        "type" VARCHAR NOT NULL,
        "timestamp" TIMESTAMP WITH TIME ZONE NOT NULL,
        "source" VARCHAR DEFAULT 'manual',
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "payroll_configs" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "store_id" VARCHAR NOT NULL,
        "employee_id" VARCHAR NOT NULL,
        "hourly_rate_gross" INTEGER DEFAULT 1200,
        "contract_hours_week" DECIMAL DEFAULT 35,
        UNIQUE ("store_id", "employee_id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "staffing_snapshots" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "store_id" VARCHAR NOT NULL,
        "level" VARCHAR DEFAULT 'unknown',
        "active_cashiers_count" INTEGER DEFAULT 0,
        "current_hour_tx" INTEGER DEFAULT 0,
        "current_hour_revenue" INTEGER DEFAULT 0,
        "active_cashiers" JSONB DEFAULT '[]',
        "hourly_snapshots" JSONB DEFAULT '[]',
        "last_recommendation" JSONB,
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Drop pos_sessions
    await queryRunner.query(`DROP TABLE IF EXISTS "pos_sessions";`);

    // Remove snapshot columns from sales
    await queryRunner.query(`
      ALTER TABLE "sales"
        DROP COLUMN IF EXISTS "employee_name_snapshot",
        DROP COLUMN IF EXISTS "employee_role_snapshot",
        DROP COLUMN IF EXISTS "employee_max_discount_snapshot";
    `);
  }
}
