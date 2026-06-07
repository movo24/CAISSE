import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Credit notes (avoirs) / returns.
 *
 * NF525: returns are append-only events with their own per-store hash chain;
 * the original sale is never mutated. Stock is re-incremented inside the same
 * transaction; every return is also logged to audit_entries (existing chain).
 */
export class AddCreditNotes1714000000000 implements MigrationInterface {
  name = 'AddCreditNotes1714000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS credit_notes (
        id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        code varchar(20) NOT NULL,
        store_id varchar NOT NULL,
        original_sale_id uuid NOT NULL,
        original_ticket_number varchar,
        type varchar NOT NULL,
        refund_method varchar,
        status varchar NOT NULL DEFAULT 'active',
        reason text,
        employee_id varchar NOT NULL,
        employee_name_snapshot varchar,
        total_minor_units integer NOT NULL,
        remaining_minor_units integer NOT NULL DEFAULT 0,
        currency_code varchar NOT NULL DEFAULT 'EUR',
        hash_chain_prev varchar,
        hash_chain_current varchar,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_notes_code ON credit_notes(code)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_credit_notes_store_created ON credit_notes(store_id, created_at)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_credit_notes_original_sale ON credit_notes(original_sale_id)`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS credit_note_lines (
        id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        credit_note_id uuid NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
        original_line_item_id uuid,
        product_id varchar NOT NULL,
        product_name varchar,
        ean varchar,
        quantity integer NOT NULL,
        unit_price_minor_units integer NOT NULL,
        line_total_minor_units integer NOT NULL,
        tax_rate decimal NOT NULL DEFAULT 20
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_credit_note_lines_cn ON credit_note_lines(credit_note_id)`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS credit_note_redemptions (
        id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        credit_note_id uuid NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
        sale_id uuid NOT NULL,
        store_id varchar NOT NULL,
        amount_minor_units integer NOT NULL,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_cn_redemptions_cn ON credit_note_redemptions(credit_note_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_cn_redemptions_sale ON credit_note_redemptions(sale_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS credit_note_redemptions`);
    await queryRunner.query(`DROP TABLE IF EXISTS credit_note_lines`);
    await queryRunner.query(`DROP TABLE IF EXISTS credit_notes`);
  }
}
