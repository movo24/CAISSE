import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Create multi-entity hierarchy: Organization → Unit → Store
 * Also creates connected_apps table.
 * All operations use IF NOT EXISTS for idempotency.
 */
export class MultiEntityHierarchy1710600000000 implements MigrationInterface {
  name = 'MultiEntityHierarchy1710600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Organizations table ──
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "organizations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" varchar NOT NULL,
        "legal_name" varchar,
        "siret" varchar,
        "siren" varchar,
        "tva_intracom" varchar,
        "country" varchar NOT NULL DEFAULT 'FR',
        "currency_code" varchar NOT NULL DEFAULT 'EUR',
        "logo_url" text,
        "email" varchar,
        "phone" varchar,
        "address" varchar,
        "city" varchar,
        "postal_code" varchar,
        "is_active" boolean NOT NULL DEFAULT true,
        "notes" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_organizations" PRIMARY KEY ("id")
      )
    `);

    // ── Units table ──
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "units" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" uuid NOT NULL,
        "name" varchar NOT NULL,
        "type" varchar NOT NULL DEFAULT 'retail',
        "country" varchar NOT NULL DEFAULT 'FR',
        "currency_code" varchar NOT NULL DEFAULT 'EUR',
        "is_active" boolean NOT NULL DEFAULT true,
        "notes" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_units" PRIMARY KEY ("id"),
        CONSTRAINT "FK_units_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_units_organization_active"
      ON "units" ("organization_id", "is_active")
    `);

    // ── Connected Apps table ──
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "connected_apps" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" uuid NOT NULL,
        "name" varchar NOT NULL,
        "type" varchar NOT NULL DEFAULT 'internal',
        "status" varchar NOT NULL DEFAULT 'active',
        "app_url" varchar,
        "api_url" varchar,
        "webhook_url" varchar,
        "api_key" varchar,
        "icon_url" text,
        "description" text,
        "unit_ids" jsonb NOT NULL DEFAULT '[]',
        "store_ids" jsonb NOT NULL DEFAULT '[]',
        "last_sync_at" TIMESTAMP,
        "last_error" text,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_connected_apps" PRIMARY KEY ("id"),
        CONSTRAINT "FK_connected_apps_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_connected_apps_org_active"
      ON "connected_apps" ("organization_id", "is_active")
    `);

    // ── Add hierarchy columns to stores ──
    await queryRunner.query(`
      ALTER TABLE "stores"
      ADD COLUMN IF NOT EXISTS "organization_id" uuid,
      ADD COLUMN IF NOT EXISTS "unit_id" uuid,
      ADD COLUMN IF NOT EXISTS "store_code" varchar,
      ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT now()
    `);

    // Add foreign keys (only if they don't exist)
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'FK_stores_organization'
        ) THEN
          ALTER TABLE "stores"
          ADD CONSTRAINT "FK_stores_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL;
        END IF;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'FK_stores_unit'
        ) THEN
          ALTER TABLE "stores"
          ADD CONSTRAINT "FK_stores_unit"
          FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE SET NULL;
        END IF;
      END $$
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_stores_organization_active"
      ON "stores" ("organization_id", "is_active")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_stores_unit_active"
      ON "stores" ("unit_id", "is_active")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "stores" DROP CONSTRAINT IF EXISTS "FK_stores_unit"`);
    await queryRunner.query(`ALTER TABLE "stores" DROP CONSTRAINT IF EXISTS "FK_stores_organization"`);
    await queryRunner.query(`ALTER TABLE "stores" DROP COLUMN IF EXISTS "store_code"`);
    await queryRunner.query(`ALTER TABLE "stores" DROP COLUMN IF EXISTS "unit_id"`);
    await queryRunner.query(`ALTER TABLE "stores" DROP COLUMN IF EXISTS "organization_id"`);
    await queryRunner.query(`ALTER TABLE "stores" DROP COLUMN IF EXISTS "updated_at"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "connected_apps"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "units"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "organizations"`);
  }
}
