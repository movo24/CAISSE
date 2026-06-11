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
 * ┌─ MANDATORY PRE-DEPLOY GATE (human, on the fiscal DB — NOT the agent) ─┐
 * │ ALTER COLUMN SET NOT NULL scans the whole table and FAILS if a single │
 * │ row has a null hash. Before deploying the commit that carries this    │
 * │ migration, run on `caisse_pos`:                                       │
 * │                                                                       │
 * │   SELECT count(*) FROM sales                                          │
 * │   WHERE hash_chain_current IS NULL OR hash_chain_prev IS NULL;        │
 * │                                                                       │
 * │   • 0   → the migration applies clean. Deploy.                        │
 * │   • >0  → STOP. These are pre-existing UN-SEALED fiscal sales (legacy │
 * │          pre-hash-chain rows, or rows from the now-closed second door │
 * │          if it ever ran) = an incident. You CANNOT retro-seal a hash  │
 * │          (it would not be in the real chain). Decide their status     │
 * │          deliberately and document it BEFORE tightening the column.   │
 * │          The migration is a damage DETECTOR — do not discover the     │
 * │          damage via a failed prod deploy.                             │
 * └───────────────────────────────────────────────────────────────────────┘
 *
 * (The Railway deploy log will only show "Migration … executed successfully"
 * if the count is 0 — but run the SELECT first so you know before, not after.)
 */
export class SalesHashChainNotNull1722000000000 implements MigrationInterface {
  name = 'SalesHashChainNotNull1722000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
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
