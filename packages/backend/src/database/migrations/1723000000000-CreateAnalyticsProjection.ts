import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Étage 0 — analytics-projection read model (Wesley Command Center). INV-1/INV-2.
 *
 * A dedicated Postgres **schema** `analytics` holding the read-model tables, distinct
 * from every source/transactional table in `public`. The cockpit reads ONLY these;
 * refresh jobs are the only writers, deriving from the sources (INV-4). Every row
 * carries `store_id` (INV-5 scope key) and `computed_at` (freshness). Additive +
 * reversible.
 *
 * Why a real schema (ratified): the API's DB role can be granted exactly
 * `GRANT USAGE ON SCHEMA analytics` + `GRANT SELECT ON ALL TABLES IN SCHEMA analytics`
 * and nothing else — INV-1/INV-2 enforced at the database level, read-only by
 * construction. Entities declare `schema: 'analytics'`, so queries are schema-qualified
 * (no search_path dependency). The schema is created here before the tables.
 */
export class CreateAnalyticsProjection1723000000000 implements MigrationInterface {
  name = 'CreateAnalyticsProjection1723000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS analytics`);

    // ── analytics.store_daily : (store, business_day) POS summary ──
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS analytics.store_daily (
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
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_store_daily_store_day ON analytics.store_daily(store_id, business_day)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_store_daily_store ON analytics.store_daily(store_id)`);

    // ── analytics.store_sessions : current POS-session snapshot ──
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS analytics.store_sessions (
        id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        store_id          uuid NOT NULL,
        open_sessions     integer NOT NULL DEFAULT 0,
        active_terminals  integer NOT NULL DEFAULT 0,
        computed_at       timestamptz NOT NULL
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_store_sessions_store ON analytics.store_sessions(store_id)`);

    // ── analytics.store_presence : staff-presence snapshot (TimeWin24 proxy) ──
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS analytics.store_presence (
        id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        store_id        uuid NOT NULL,
        present_count   integer NOT NULL DEFAULT 0,
        expected_count  integer NOT NULL DEFAULT 0,
        computed_at     timestamptz NOT NULL
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_store_presence_store ON analytics.store_presence(store_id)`);

    // ── analytics.store_stock : rupture/low-stock snapshot (stock_balances) ──
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS analytics.store_stock (
        id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        store_id          uuid NOT NULL,
        rupture_count     integer NOT NULL DEFAULT 0,
        low_stock_count   integer NOT NULL DEFAULT 0,
        computed_at       timestamptz NOT NULL
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_store_stock_store ON analytics.store_stock(store_id)`);

    // ── analytics.store_registry : denormalized org → unit → store list ──
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS analytics.store_registry (
        store_id        uuid PRIMARY KEY,
        name            varchar NOT NULL,
        organization_id uuid,
        unit_id         uuid,
        is_active       boolean NOT NULL DEFAULT true,
        computed_at     timestamptz NOT NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_store_registry_org ON analytics.store_registry(organization_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS analytics.store_registry`);
    await queryRunner.query(`DROP TABLE IF EXISTS analytics.store_stock`);
    await queryRunner.query(`DROP TABLE IF EXISTS analytics.store_presence`);
    await queryRunner.query(`DROP TABLE IF EXISTS analytics.store_sessions`);
    await queryRunner.query(`DROP TABLE IF EXISTS analytics.store_daily`);
    await queryRunner.query(`DROP SCHEMA IF EXISTS analytics`);
  }
}
