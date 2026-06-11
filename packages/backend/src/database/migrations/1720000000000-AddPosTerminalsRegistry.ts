import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * (1b) first brick — POS terminal registry (logical till), store-scoped.
 *
 * Gives pos_sessions.terminal_id (γ, free-text from X-Terminal-Id) a
 * referent so the claim can be validated against the JWT's store.
 *
 * Additive: new table only, no change to existing tables. The partial
 * unique index enforces "one active terminal_code per store" atomically at
 * the DB level (γ TOCTOU lesson) — concurrent provisioning of the same code
 * makes the loser fail with 23505, which the service maps to 409.
 */
export class AddPosTerminalsRegistry1720000000000 implements MigrationInterface {
  name = 'AddPosTerminalsRegistry1720000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS pos_terminals (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id      varchar NOT NULL,
        terminal_code varchar NOT NULL,
        label         varchar,
        is_active     boolean NOT NULL DEFAULT true,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_pos_terminals_store_active
        ON pos_terminals(store_id, is_active)
    `);

    // One active terminal_code per store — atomic DB invariant.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_terminals_store_code_active
        ON pos_terminals(store_id, terminal_code)
        WHERE is_active
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uq_pos_terminals_store_code_active`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_pos_terminals_store_active`);
    await queryRunner.query(`DROP TABLE IF EXISTS pos_terminals`);
  }
}
