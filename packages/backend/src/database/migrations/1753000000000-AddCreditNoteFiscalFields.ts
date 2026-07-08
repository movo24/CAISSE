import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * D1.4 (GO owner) — l'avoir est la pièce opposable : champs fiscaux manquants.
 *
 * Additive, réversible, AUCUNE écriture sur les lignes existantes :
 *  - sequential_number : numéro d'avoir séquentiel par magasin (unique). Les
 *    avoirs historiques gardent NULL — on ne renumérote jamais l'histoire.
 *  - tax_total_minor_units : ventilation TVA de l'avoir (TTC déjà présent ;
 *    HT = total - tax, dérivé).
 *  - approved_by_employee_id : manager/admin ayant validé un remboursement cash.
 *
 * Ces colonnes restent HORS de l'empreinte hash des avoirs (allowlist
 * {code, storeId, originalSaleId, total, lines} inchangée → aucun avoir
 * re-hashé) ; elles sont scellées via les maillons fiscal_journal émis à la
 * création (credit_note_issued / cash_refund_recorded / stock_restored).
 */
export class AddCreditNoteFiscalFields1753000000000 implements MigrationInterface {
  name = 'AddCreditNoteFiscalFields1753000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS sequential_number integer`,
    );
    await queryRunner.query(
      `ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS tax_total_minor_units integer`,
    );
    await queryRunner.query(
      `ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS approved_by_employee_id uuid`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_notes_store_seq
         ON credit_notes (store_id, sequential_number)
        WHERE sequential_number IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_credit_notes_store_seq`);
    await queryRunner.query(`ALTER TABLE credit_notes DROP COLUMN IF EXISTS approved_by_employee_id`);
    await queryRunner.query(`ALTER TABLE credit_notes DROP COLUMN IF EXISTS tax_total_minor_units`);
    await queryRunner.query(`ALTER TABLE credit_notes DROP COLUMN IF EXISTS sequential_number`);
  }
}
