import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add legal-identity, operating-mode and operational parameters to `stores`.
 *
 * Purely ADDITIVE and non-destructive: every column is added with a safe
 * default (or nullable), so existing stores stay valid, visible and editable.
 * The legal registration numbers (siren/siret/tva_intracom/forme_juridique/
 * rcs/capital_social) already exist on `stores` and are reused for the
 * operating company's identity.
 */
export class AddStoreLegalIdentity1745000000000 implements MigrationInterface {
  name = 'AddStoreLegalIdentity1745000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "stores"
        ADD COLUMN IF NOT EXISTS "store_type" varchar,
        ADD COLUMN IF NOT EXISTS "address_extra" varchar,
        ADD COLUMN IF NOT EXISTS "country" varchar NOT NULL DEFAULT 'France',
        ADD COLUMN IF NOT EXISTS "operating_mode" varchar NOT NULL DEFAULT 'succursale',
        ADD COLUMN IF NOT EXISTS "status" varchar NOT NULL DEFAULT 'ouvert',
        ADD COLUMN IF NOT EXISTS "expected_opening_date" date,
        ADD COLUMN IF NOT EXISTS "actual_opening_date" date,
        ADD COLUMN IF NOT EXISTS "operating_company_name" varchar,
        ADD COLUMN IF NOT EXISTS "operating_company_trade_name" varchar,
        ADD COLUMN IF NOT EXISTS "allow_pos" boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "allow_stock" boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "allow_reporting" boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "is_pilot_store" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "manager_name" varchar,
        ADD COLUMN IF NOT EXISTS "manager_email" varchar,
        ADD COLUMN IF NOT EXISTS "manager_phone" varchar
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "stores"
        DROP COLUMN IF EXISTS "manager_phone",
        DROP COLUMN IF EXISTS "manager_email",
        DROP COLUMN IF EXISTS "manager_name",
        DROP COLUMN IF EXISTS "is_pilot_store",
        DROP COLUMN IF EXISTS "allow_reporting",
        DROP COLUMN IF EXISTS "allow_stock",
        DROP COLUMN IF EXISTS "allow_pos",
        DROP COLUMN IF EXISTS "operating_company_trade_name",
        DROP COLUMN IF EXISTS "operating_company_name",
        DROP COLUMN IF EXISTS "actual_opening_date",
        DROP COLUMN IF EXISTS "expected_opening_date",
        DROP COLUMN IF EXISTS "status",
        DROP COLUMN IF EXISTS "operating_mode",
        DROP COLUMN IF EXISTS "country",
        DROP COLUMN IF EXISTS "address_extra",
        DROP COLUMN IF EXISTS "store_type"
    `);
  }
}
