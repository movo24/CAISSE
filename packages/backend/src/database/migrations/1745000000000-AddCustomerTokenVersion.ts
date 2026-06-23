import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Mobile-auth token revocation: a per-customer token_version. Bumped on
 * logout / soft-delete / security reset so every previously-issued JWT (which
 * carries `tv`) is rejected by MobileAuthGuard. Additive + reversible.
 */
export class AddCustomerTokenVersion1745000000000 implements MigrationInterface {
  name = 'AddCustomerTokenVersion1745000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE customers DROP COLUMN IF EXISTS token_version`);
  }
}
