import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * (H4) Make the sales fiscal hash-chain columns NOT NULL.
 *
 * Pairs with closing the offline raw-save door in sync.service: there must be
 * a SINGLE sealing path into `sales` (createSale, under the per-store
 * FOR UPDATE lock), and a row can never be unsealed. The nullable columns were
 * the structural enabler of the chain fork — this makes the unsealed state
 * non-representable at the schema level.
 *
 * Safe on the current prod (`caisse_pos` is empty / greenfield). createSale
 * always sets both (genesis hash for the first sale).
 *
 * A6 (ratified): the pre-deploy gate is INTERNAL — the migration itself counts
 * the un-sealed rows and RAISES with an explicit diagnosis BEFORE any ALTER.
 * No human checklist on the deploy path (prevent-at-write, not advise-at-deploy):
 * a dirty table can never be discovered via a half-applied ALTER failure.
 */
export class SalesHashChainNotNull1722000000000 implements MigrationInterface {
  name = 'SalesHashChainNotNull1722000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── INTERNAL GATE (A6): refuse to tighten over un-sealed fiscal rows ──
    // >0 means pre-existing UN-SEALED sales (legacy pre-hash-chain rows, or rows
    // from the now-closed second door if it ever ran) = an incident. A hash can
    // NOT be retro-sealed (it would not be in the real chain): their status must
    // be decided deliberately and documented BEFORE this column tightens. The
    // RAISE makes the migration a damage DETECTOR that stops the deploy itself.
    const [{ unsealed }] = await queryRunner.query(
      `SELECT count(*)::int AS unsealed FROM sales
       WHERE hash_chain_current IS NULL OR hash_chain_prev IS NULL`,
    );
    if (Number(unsealed) > 0) {
      throw new Error(
        `[H4 GATE] ${unsealed} sales row(s) have a NULL hash_chain_prev/current — ` +
          `pre-existing UN-SEALED fiscal rows. STOP: a hash cannot be retro-sealed; ` +
          `decide and document their status before applying SalesHashChainNotNull1722000000000. ` +
          `Nothing was altered (the migration transaction rolls back).`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE sales ALTER COLUMN hash_chain_prev SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE sales ALTER COLUMN hash_chain_current SET NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE sales ALTER COLUMN hash_chain_current DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE sales ALTER COLUMN hash_chain_prev DROP NOT NULL`,
    );
  }
}
