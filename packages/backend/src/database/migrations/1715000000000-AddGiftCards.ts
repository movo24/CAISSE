import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gift cards reuse the credit_notes (store_credit) mechanism but are not issued
 * from a return. So: original_sale_id becomes nullable, and an `origin` column
 * distinguishes a return-issued avoir from a gift card.
 */
export class AddGiftCards1715000000000 implements MigrationInterface {
  name = 'AddGiftCards1715000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE credit_notes ALTER COLUMN original_sale_id DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS origin varchar NOT NULL DEFAULT 'return'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE credit_notes DROP COLUMN IF EXISTS origin`);
    // Re-tightening NOT NULL is unsafe if gift cards exist; left nullable on rollback.
  }
}
