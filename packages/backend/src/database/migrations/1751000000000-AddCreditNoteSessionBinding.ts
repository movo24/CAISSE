import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cash-movement probity — bind returns/refunds to the POS session they were
 * rung under, and decompose the session's expected cash.
 *
 * - `credit_notes.session_id` / `terminal_id`: resolved SERVER-SIDE from the
 *   terminal's active session at return creation (same doctrine as
 *   sales.session_id, migration 1748) — never accepted from the client.
 * - `pos_sessions.cash_refunds_minor_units`: sum of the CASH refunds bound to
 *   the session, so expected = opening + cash sales − cash refunds is fully
 *   auditable.
 *
 * Additive + fully reversible: nullable columns, no default → NO write to
 * existing rows. Legacy credit notes keep NULL ("session unknown", a factual,
 * auditable state — never a fabricated binding). The columns are OUTSIDE the
 * credit-note hash-chain payload ({code, storeId, originalSaleId, total,
 * lines}), so no avoir is rehashed and every existing hash still verifies.
 */
export class AddCreditNoteSessionBinding1751000000000 implements MigrationInterface {
  name = 'AddCreditNoteSessionBinding1751000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS session_id uuid`);
    await queryRunner.query(`ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS terminal_id varchar`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_credit_notes_session_id ON credit_notes (session_id) WHERE session_id IS NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE pos_sessions ADD COLUMN IF NOT EXISTS cash_refunds_minor_units integer`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE pos_sessions DROP COLUMN IF EXISTS cash_refunds_minor_units`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_credit_notes_session_id`);
    await queryRunner.query(`ALTER TABLE credit_notes DROP COLUMN IF EXISTS terminal_id`);
    await queryRunner.query(`ALTER TABLE credit_notes DROP COLUMN IF EXISTS session_id`);
  }
}
