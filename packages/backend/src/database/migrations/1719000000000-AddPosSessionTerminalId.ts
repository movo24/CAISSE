import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * γ-model (D1 decision) — sessions are terminal-bound.
 *
 * Adds `terminal_id` to pos_sessions: the physical terminal identifier,
 * captured from the X-Terminal-Id header at session open. The uniqueness
 * invariant becomes applicative: ONE active session per (store_id,
 * terminal_id) — an employee may hold sessions on several terminals, a
 * terminal can never have two concurrent active sessions.
 *
 * Column is nullable at the DB level (additive, never destructive — safe
 * even if rows exist); the application refuses to open a session without
 * a terminal_id, so every new row carries one. The composite index serves
 * the active-session-per-terminal lookup, which is the hot path of the
 * future (1b) binding.
 */
export class AddPosSessionTerminalId1719000000000 implements MigrationInterface {
  name = 'AddPosSessionTerminalId1719000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE pos_sessions ADD COLUMN IF NOT EXISTS terminal_id varchar`,
    );
    // PARTIAL UNIQUE index — the γ invariant is enforced by the DB, not only
    // by the service's check-then-insert (which alone would be a TOCTOU race:
    // two concurrent opens on the same terminal could both pass the check and
    // both insert). With this index the second insert fails atomically
    // (unique_violation 23505), which the service maps to 409 Conflict.
    // Doubles as the lookup index for findActiveForTerminal (same prefix).
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_sessions_store_terminal_active
         ON pos_sessions(store_id, terminal_id)
         WHERE is_active`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uq_pos_sessions_store_terminal_active`);
    await queryRunner.query(`ALTER TABLE pos_sessions DROP COLUMN IF EXISTS terminal_id`);
  }
}
