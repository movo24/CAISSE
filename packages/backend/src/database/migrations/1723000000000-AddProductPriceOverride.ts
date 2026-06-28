import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * POS-061 — `products.price_override_minor_units` : prix magasin prioritaire sur le prix global.
 *
 * Additif et non destructif : colonne NULLABLE (ADD COLUMN IF NOT EXISTS). Tant qu'elle est
 * NULL, le prix global `price_minor_units` est utilisé (aucun changement de comportement).
 * La résolution (override prioritaire) est faite côté code par `resolveEffectivePrice`.
 *
 * Réversible : `down` supprime la colonne.
 */
export class AddProductPriceOverride1723000000000 implements MigrationInterface {
  name = 'AddProductPriceOverride1723000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS price_override_minor_units integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE products DROP COLUMN IF EXISTS price_override_minor_units`,
    );
  }
}
