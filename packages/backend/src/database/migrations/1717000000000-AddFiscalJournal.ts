import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M4 — Journal fiscal append-only des annulations (et futurs événements non-vente).
 *
 * Crée `fiscal_journal` : une entrée immuable par annulation, chaînée par magasin
 * (hash_chain_prev/current) comme les ventes et les avoirs. Additif (CREATE TABLE
 * IF NOT EXISTS) : aucun impact sur les ventes/avoirs existants, aucune donnée
 * touchée. La logique d'annulation existante (flip statut + restauration stock/avoir
 * + audit) est conservée ; on y AJOUTE le maillon de chaîne.
 */
export class AddFiscalJournal1717000000000 implements MigrationInterface {
  name = 'AddFiscalJournal1717000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS fiscal_journal (
        id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        store_id varchar NOT NULL,
        event_type varchar NOT NULL,
        ref_id uuid,
        ticket_number varchar,
        payload text NOT NULL,
        hash_chain_prev varchar(64) NOT NULL,
        hash_chain_current varchar(64) NOT NULL,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_fiscal_journal_store_created ON fiscal_journal(store_id, created_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_fiscal_journal_ref ON fiscal_journal(ref_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_fiscal_journal_ref`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_fiscal_journal_store_created`);
    await queryRunner.query(`DROP TABLE IF EXISTS fiscal_journal`);
  }
}
