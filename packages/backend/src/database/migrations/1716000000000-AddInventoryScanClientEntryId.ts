import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Idempotence des scans d'inventaire offline.
 *
 * Ajoute `client_entry_id` (id de la file locale mobile) + un index composite
 * (store_id, client_entry_id) pour la dé-duplication d'un scan rejoué après une
 * réponse réseau perdue. Additif et nullable : aucun impact sur les scans
 * online existants ni sur la logique fiscale.
 */
export class AddInventoryScanClientEntryId1716000000000 implements MigrationInterface {
  name = 'AddInventoryScanClientEntryId1716000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE inventory_scans ADD COLUMN IF NOT EXISTS client_entry_id varchar(64)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_inventory_scans_store_client_entry ON inventory_scans(store_id, client_entry_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_inventory_scans_store_client_entry`);
    await queryRunner.query(`ALTER TABLE inventory_scans DROP COLUMN IF EXISTS client_entry_id`);
  }
}
