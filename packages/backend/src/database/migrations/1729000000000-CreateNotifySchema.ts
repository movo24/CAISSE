import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Étage 4 — the `notify` schema: device tokens, delivery preferences, delivery
 * ledger. SEPARATE from `analytics` on purpose: the mobile API's future DB role
 * keeps SELECT-only on analytics (D-ANALYTICS-1) while the account/notification
 * surface gets its writes here — two schemas, two grant stories, zero blur.
 * INV-6 on deliveries: UNIQUE (alert_id, device_id). Additive + reversible.
 */
export class CreateNotifySchema1729000000000 implements MigrationInterface {
  name = 'CreateNotifySchema1729000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS notify`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS notify.device_tokens (
        id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        employee_id  uuid NOT NULL,
        platform     varchar NOT NULL,
        token        varchar NOT NULL,
        is_active    boolean NOT NULL DEFAULT true,
        created_at   timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_device_tokens_token ON notify.device_tokens(token)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_device_tokens_employee ON notify.device_tokens(employee_id)`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS notify.preferences (
        employee_id       uuid PRIMARY KEY,
        enabled           boolean NOT NULL DEFAULT true,
        quiet_start_hour  integer,
        quiet_end_hour    integer,
        updated_at        timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS notify.deliveries (
        id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        alert_id    uuid NOT NULL,
        device_id   uuid NOT NULL,
        channel     varchar NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_deliveries_alert_device ON notify.deliveries(alert_id, device_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_deliveries_device ON notify.deliveries(device_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS notify.deliveries`);
    await queryRunner.query(`DROP TABLE IF EXISTS notify.preferences`);
    await queryRunner.query(`DROP TABLE IF EXISTS notify.device_tokens`);
    await queryRunner.query(`DROP SCHEMA IF EXISTS notify`);
  }
}
