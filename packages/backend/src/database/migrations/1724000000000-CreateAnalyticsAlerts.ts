import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Étage 2 — alerts-engine storage (analytics schema). INV-6 structural: the UNIQUE
 * index on (store_id, rule, business_day, threshold_band) IS the dedup — a re-fire
 * is absorbed at write time (23505), never check-then-insert.
 *
 * Thresholds are DATA: alert_config rows (store_id NULL = seeded default,
 * store-scoped overrides later). Defaults are seeded here for the four derivable
 * rules — seeding config is data, not rule wiring (rules land one commit each).
 * Additive + reversible.
 */
export class CreateAnalyticsAlerts1724000000000 implements MigrationInterface {
  name = 'CreateAnalyticsAlerts1724000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS analytics`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS analytics.alerts (
        id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        store_id        uuid NOT NULL,
        rule            varchar NOT NULL,
        business_day    date NOT NULL,
        threshold_band  varchar NOT NULL,
        payload         jsonb,
        computed_at     timestamptz NOT NULL,
        created_at      timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts_dedup ON analytics.alerts(store_id, rule, business_day, threshold_band)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_alerts_store_day ON analytics.alerts(store_id, business_day)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS analytics.alert_config (
        id        uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        store_id  uuid,
        rule      varchar NOT NULL,
        params    jsonb NOT NULL,
        is_active boolean NOT NULL DEFAULT true
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_config_rule_store ON analytics.alert_config(rule, store_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS analytics.alert_cursor (
        store_id          uuid PRIMARY KEY,
        last_computed_at  timestamptz NOT NULL
      )
    `);

    // ── Seeded defaults (store_id NULL) for the four derivable rules. Data, not wiring. ──
    await queryRunner.query(`
      INSERT INTO analytics.alert_config (id, store_id, rule, params, is_active) VALUES
        (uuid_generate_v4(), NULL, 'void_rate',         '{"warning_rate": 0.10, "critical_rate": 0.20, "min_tx": 10}', true),
        (uuid_generate_v4(), NULL, 'stock_low',         '{"low_count_min": 5}', true),
        (uuid_generate_v4(), NULL, 'sales_drop',        '{"drop_pct": 0.30, "lookback_weeks": 4, "min_weeks": 2, "min_baseline_minor": 20000}', true),
        (uuid_generate_v4(), NULL, 'store_closed_late', '{"close_hour_utc": 21}', true)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS analytics.alert_cursor`);
    await queryRunner.query(`DROP TABLE IF EXISTS analytics.alert_config`);
    await queryRunner.query(`DROP TABLE IF EXISTS analytics.alerts`);
  }
}
