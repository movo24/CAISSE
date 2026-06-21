import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Promo codes (decision 6) — shared codes with window, total usage cap, optional
 * product/category scope, active flag, and a redemption log. The usage cap is
 * enforced race-safely via a conditional UPDATE (see PromoCodesService.redeem).
 */
export class CreatePromoCodes1741000000000 implements MigrationInterface {
  name = 'CreatePromoCodes1741000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS promo_codes (
        id              uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        store_id        uuid NOT NULL,
        code            varchar NOT NULL,
        discount_type   varchar(12) NOT NULL,
        discount_value  integer NOT NULL,
        starts_at       timestamp,
        ends_at         timestamp,
        max_uses        integer,
        used_count      integer NOT NULL DEFAULT 0,
        product_id      uuid,
        category_id     uuid,
        is_active       boolean NOT NULL DEFAULT true,
        created_at      timestamp DEFAULT now() NOT NULL,
        updated_at      timestamp DEFAULT now() NOT NULL
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_promo_codes_store_code ON promo_codes(store_id, code)`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS promo_code_redemptions (
        id                            uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        promo_code_id                 uuid NOT NULL,
        store_id                      uuid NOT NULL,
        employee_id                   uuid NOT NULL,
        sale_id                       uuid,
        discount_applied_minor_units  integer,
        applied_at                    timestamp DEFAULT now() NOT NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_promo_redemptions_code ON promo_code_redemptions(promo_code_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS promo_code_redemptions CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS promo_codes CASCADE`);
  }
}
