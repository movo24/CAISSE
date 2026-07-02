import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P312 (cycle G) — TD-017-SESSION-LINK.
 *
 * Adds the missing link sale → POS session so the cash sales of a session can
 * be aggregated for the till count (comptage, POS-017b prerequisite).
 *
 * Additive & reversible: nullable uuid column + composite index. Existing rows
 * keep NULL (sales made before the link, or without an X-Terminal-Id session).
 * ⚠️ NOT run on the target DB from the sandbox — same gate as 1725 (GATE 2).
 */
export class AddSalePosSessionId1726000000000 implements MigrationInterface {
  name = 'AddSalePosSessionId1726000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "pos_session_id" uuid NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_sales_store_pos_session" ON "sales" ("store_id", "pos_session_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_sales_store_pos_session"`);
    await queryRunner.query(`ALTER TABLE "sales" DROP COLUMN IF EXISTS "pos_session_id"`);
  }
}
