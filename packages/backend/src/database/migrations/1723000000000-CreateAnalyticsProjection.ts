import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Étage 0 — analytics-projection read model (Wesley Command Center). INV-2.
 *
 * A SEPARATE set of read-model tables (`analytics_*`), distinct from every source/
 * transactional table. The cockpit reads ONLY these; refresh jobs are the only
 * writers, deriving from the sources (INV-4). Every row carries `store_id` (INV-5
 * scope key) and `computed_at` (freshness). Additive + reversible.
 *
 * V1 isolates by table prefix in the public schema (the test harness globs all
 * entities + synchronizes against pg-mem's public schema; a dedicated Postgres
 * `analytics` schema would break every existing spec). RLS-ready evolution: a later
 * migration moves these (already source-free) tables into an `analytics` schema and
 * attaches RLS policies.
 */
export class CreateAnalyticsProjection1723000000000 implements MigrationInterface {
  name = 'CreateAnalyticsProjection1723000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── store_daily : (store, business_day) POS summary (CA / voids / returns / net) ──
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS analytics_store_daily (
        id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        store_id              uuid NOT NULL,
        business_day          date NOT NULL,
        ca_brut_minor         integer NOT NULL DEFAULT 0,
        tx_count              integer NOT NULL DEFAULT 0,
        void_count            integer NOT NULL DEFAULT 0,
        void_amount_minor     integer NOT NULL DEFAULT 0,
        returns_amount_minor  integer NOT NULL DEFAULT 0,
        net_minor             integer NOT NULL DEFAULT 0,
        by_tender             jsonb,
        computed_at           timestamptz NOT NULL
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_analytics_store_daily_store_day ON analytics_store_daily(store_id, business_day)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_analytics_store_daily_store ON analytics_store_daily(store_id)`,
    );

    // ── store_sessions : current POS-session snapshot per store ──
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS analytics_store_sessions (
        id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        store_id          uuid NOT NULL,
        open_sessions     integer NOT NULL DEFAULT 0,
        active_terminals  integer NOT NULL DEFAULT 0,
        computed_at       timestamptz NOT NULL
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_analytics_store_sessions_store ON analytics_store_sessions(store_id)`,
    );

    // ── store_presence : staff-presence snapshot (TimeWin24 proxy) per store ──
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS analytics_store_presence (
        id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        store_id        uuid NOT NULL,
        present_count   integer NOT NULL DEFAULT 0,
        expected_count  integer NOT NULL DEFAULT 0,
        computed_at     timestamptz NOT NULL
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_analytics_store_presence_store ON analytics_store_presence(store_id)`,
    );

    // ── store_stock : rupture/low-stock snapshot (stock_balances) per store ──
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS analytics_store_stock (
        id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        store_id          uuid NOT NULL,
        rupture_count     integer NOT NULL DEFAULT 0,
        low_stock_count   integer NOT NULL DEFAULT 0,
        computed_at       timestamptz NOT NULL
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_analytics_store_stock_store ON analytics_store_stock(store_id)`,
    );

    // ── store_registry : denormalized store list (org → unit → store) for the cockpit ──
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS analytics_store_registry (
        store_id        uuid PRIMARY KEY,
        name            varchar NOT NULL,
        organization_id uuid,
        unit_id         uuid,
        is_active       boolean NOT NULL DEFAULT true,
        computed_at     timestamptz NOT NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_analytics_store_registry_org ON analytics_store_registry(organization_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS analytics_store_registry`);
    await queryRunner.query(`DROP TABLE IF EXISTS analytics_store_stock`);
    await queryRunner.query(`DROP TABLE IF EXISTS analytics_store_presence`);
    await queryRunner.query(`DROP TABLE IF EXISTS analytics_store_sessions`);
    await queryRunner.query(`DROP TABLE IF EXISTS analytics_store_daily`);
  }
}
