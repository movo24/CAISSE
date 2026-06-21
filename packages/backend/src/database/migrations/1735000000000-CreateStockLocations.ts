import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bloc 6 (POS mission) — create the multi-location stock tables.
 *
 * The StockLocationsService (transfer / dispatch / receiveFromSupplier /
 * movement history) and its three entities were fully written and exercised in
 * tests via `synchronize`, but NO migration ever created their tables — so in
 * production (migrations only, synchronize off) every multi-location call failed
 * with table-not-found. This migration is the faithful transcription of the
 * entity definitions (stock-location / stock-balance / stock-movement.entity.ts),
 * making the coded subsystem runnable in prod.
 *
 * - stock_locations  : physical/logical stock places (central / store / transit / loss)
 * - stock_balances   : current qty per (product, location) — fast-read state
 * - stock_movements  : immutable journal; every qty change is a movement (audit trail)
 *
 * Additive + reversible. FK ON DELETE matches the entities exactly (balances
 * CASCADE with product/location; movements CASCADE with product, SET NULL with
 * locations so the journal survives a location deletion).
 */
export class CreateStockLocations1735000000000 implements MigrationInterface {
  name = 'CreateStockLocations1735000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── stock_locations ──
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS stock_locations (
        id          uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        name        varchar(100) NOT NULL,
        code        varchar(20) NOT NULL UNIQUE,
        type        varchar(20) NOT NULL DEFAULT 'store',
        store_id    uuid REFERENCES stores(id) ON DELETE SET NULL,
        is_active   boolean NOT NULL DEFAULT true,
        address     varchar,
        created_at  timestamp DEFAULT now() NOT NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_stock_locations_type ON stock_locations(type)`);

    // ── stock_balances ──
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS stock_balances (
        id                  uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        product_id          uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        location_id         uuid NOT NULL REFERENCES stock_locations(id) ON DELETE CASCADE,
        quantity            integer NOT NULL DEFAULT 0,
        alert_threshold     integer NOT NULL DEFAULT 10,
        critical_threshold  integer NOT NULL DEFAULT 5,
        updated_at          timestamp DEFAULT now() NOT NULL,
        UNIQUE(product_id, location_id)
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_stock_balances_location ON stock_balances(location_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_stock_balances_product ON stock_balances(product_id)`);

    // ── stock_movements (immutable journal) ──
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS stock_movements (
        id                uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        product_id        uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        movement_type     varchar(30) NOT NULL,
        from_location_id  uuid REFERENCES stock_locations(id) ON DELETE SET NULL,
        to_location_id    uuid REFERENCES stock_locations(id) ON DELETE SET NULL,
        quantity          integer NOT NULL,
        reference         varchar(100),
        reason            varchar(500),
        note              varchar,
        employee_id       varchar(100) NOT NULL,
        employee_name     varchar(200) NOT NULL,
        created_at        timestamp DEFAULT now() NOT NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_stock_movements_product_created ON stock_movements(product_id, created_at)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_stock_movements_from ON stock_movements(from_location_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_stock_movements_to ON stock_movements(to_location_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_stock_movements_type ON stock_movements(movement_type)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON stock_movements(created_at)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS stock_movements CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS stock_balances CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS stock_locations CASCADE`);
  }
}
