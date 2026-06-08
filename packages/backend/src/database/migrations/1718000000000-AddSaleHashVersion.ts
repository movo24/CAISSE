import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M2 — Versionnage de l'empreinte de hash des ventes.
 *
 * Ajoute `hash_version` (smallint, défaut 1). Les ventes existantes restent en
 * v1 (empreinte partielle) et ne sont JAMAIS recalculées (immuabilité NF525).
 * Les nouvelles ventes passent en v2 (empreinte liant TVA, remise, paiements,
 * horodatage, client). La colonne permet à un vérificateur de choisir la bonne
 * formule par ligne. Additif et non destructif.
 */
export class AddSaleHashVersion1718000000000 implements MigrationInterface {
  name = 'AddSaleHashVersion1718000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE sales ADD COLUMN IF NOT EXISTS hash_version smallint NOT NULL DEFAULT 1`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE sales DROP COLUMN IF EXISTS hash_version`);
  }
}
