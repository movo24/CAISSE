import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add is_archived column to stores table for archive/activate/deactivate lifecycle.
 * Idempotent — safe to re-run.
 */
export class AddStoreIsArchived1710700000000 implements MigrationInterface {
  name = 'AddStoreIsArchived1710700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "stores"
      ADD COLUMN IF NOT EXISTS "is_archived" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "stores"
      DROP COLUMN IF EXISTS "is_archived"
    `);
  }
}
