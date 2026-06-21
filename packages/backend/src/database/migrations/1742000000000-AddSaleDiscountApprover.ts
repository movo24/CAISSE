import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Discount enforcement (decision 5) — capture the manager/admin who authorised a
 * manual discount on a sale. Additive + reversible.
 */
export class AddSaleDiscountApprover1742000000000 implements MigrationInterface {
  name = 'AddSaleDiscountApprover1742000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE sales ADD COLUMN IF NOT EXISTS discount_approver_id uuid`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE sales DROP COLUMN IF EXISTS discount_approver_id`);
  }
}
