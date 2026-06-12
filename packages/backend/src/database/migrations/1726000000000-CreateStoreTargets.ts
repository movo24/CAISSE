import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Étage 2 (target_reached resolution, GO'd): analytics.store_targets — the daily
 * revenue objective per store, as DATA (one source, two readers: the target_reached
 * rule and the overview %atteint). NO seed here: the B43 value is an owner input
 * (a management decision) — seeding it is one INSERT once provided:
 *   INSERT INTO analytics.store_targets (store_id, daily_target_minor)
 *   VALUES ('<B43 store uuid>', <value>);
 * No datum = no objective: rule silent, overview null (INV-3: nothing fabricated).
 * Additive + reversible.
 */
export class CreateStoreTargets1726000000000 implements MigrationInterface {
  name = 'CreateStoreTargets1726000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS analytics.store_targets (
        store_id            uuid PRIMARY KEY,
        daily_target_minor  integer NOT NULL,
        is_active           boolean NOT NULL DEFAULT true,
        updated_at          timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS analytics.store_targets`);
  }
}
