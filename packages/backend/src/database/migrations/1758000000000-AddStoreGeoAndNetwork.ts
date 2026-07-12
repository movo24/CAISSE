import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fix a critical entity/migration drift on `stores`.
 *
 * `StoreEntity` declares `latitude`, `longitude` (geo) and `network_id`
 * (multi-store grouping) but NO migration ever created these columns. On any
 * migration-built database (production Backend B included), every full-entity
 * SELECT on `stores` — notably the store lookup inside `POST /api/auth/login/pin`
 * (`storeRepo.findOne({ where: { storeCode } })`) — fails with
 * `column StoreEntity.latitude does not exist` → the register login returns
 * HTTP 500 for everyone. This was latent because the deploy smoke never hit the
 * store lookup (empty-body login is rejected at validation, before the query).
 *
 * Additive + idempotent (`IF NOT EXISTS`), nullable, no data touched. Matches the
 * entity exactly: latitude/longitude = numeric(10,7), network_id = varchar.
 */
export class AddStoreGeoAndNetwork1758000000000 implements MigrationInterface {
  name = 'AddStoreGeoAndNetwork1758000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "latitude" numeric(10,7)`,
    );
    await queryRunner.query(
      `ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "longitude" numeric(10,7)`,
    );
    await queryRunner.query(
      `ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "network_id" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "stores" DROP COLUMN IF EXISTS "network_id"`);
    await queryRunner.query(`ALTER TABLE "stores" DROP COLUMN IF EXISTS "longitude"`);
    await queryRunner.query(`ALTER TABLE "stores" DROP COLUMN IF EXISTS "latitude"`);
  }
}
