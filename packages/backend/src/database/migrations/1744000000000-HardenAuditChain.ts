import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M402 — harden the audit hash chain.
 *
 * 1. `hashed_at` (nullable): the EXACT ISO instant that went into a v2 hash. NULL =
 *    legacy v1 row (its `details` were never covered by the hash) → linkage-only
 *    verification. Set on every new row → `verifyChain` recomputes and detects
 *    content tampering.
 * 2. Unique index `(store_id, previous_hash)` — anti-fork: two entries can no longer
 *    chain on the same parent. AuditService.doLog retries on the resulting conflict.
 *
 * SAFE/ADDITIVE: adds a nullable column + a unique index. The index creation FAILS
 * LOUDLY (with the offending pairs) if the live table already contains a fork, rather
 * than corrupting silently — that fork must be investigated before the index lands.
 */
export class HardenAuditChain1744000000000 implements MigrationInterface {
  name = 'HardenAuditChain1744000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE audit_entries ADD COLUMN IF NOT EXISTS hashed_at varchar`);

    // Pre-check: refuse to create the unique index if existing data already forks.
    const dups: Array<{ store_id: string; previous_hash: string; n: string }> = await queryRunner.query(
      `SELECT store_id, previous_hash, COUNT(*) AS n
         FROM audit_entries
         GROUP BY store_id, previous_hash
         HAVING COUNT(*) > 1`,
    );
    if (Array.isArray(dups) && dups.length > 0) {
      const sample = dups.slice(0, 5).map((d) => `store=${d.store_id} prev=${String(d.previous_hash).slice(0, 12)}… ×${d.n}`).join('; ');
      throw new Error(
        `M402: cannot create unique (store_id, previous_hash) — ${dups.length} forked group(s) exist in audit_entries. ` +
        `Investigate the chain integrity before migrating. Sample: ${sample}`,
      );
    }

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UX_audit_store_prevhash" ON audit_entries (store_id, previous_hash)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UX_audit_store_prevhash"`);
    await queryRunner.query(`ALTER TABLE audit_entries DROP COLUMN IF EXISTS hashed_at`);
  }
}
