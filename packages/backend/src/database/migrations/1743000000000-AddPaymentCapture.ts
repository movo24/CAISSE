import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Card capture / payment-pending (decision 6) — a payment leg tracks whether it
 * is REALLY captured. An uncaptured card leg makes the sale payment_pending (never
 * "paid") until regularised. Existing legs default to captured=true (cash/realized).
 */
export class AddPaymentCapture1743000000000 implements MigrationInterface {
  name = 'AddPaymentCapture1743000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE sale_payments ADD COLUMN IF NOT EXISTS captured boolean NOT NULL DEFAULT true`);
    await queryRunner.query(`ALTER TABLE sale_payments ADD COLUMN IF NOT EXISTS captured_at timestamp`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE sale_payments DROP COLUMN IF EXISTS captured_at`);
    await queryRunner.query(`ALTER TABLE sale_payments DROP COLUMN IF EXISTS captured`);
  }
}
