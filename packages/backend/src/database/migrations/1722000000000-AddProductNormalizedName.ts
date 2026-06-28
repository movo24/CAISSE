import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * POS-066 — `products.normalized_name` pour la déduplication par nom normalisé
 * (même nom normalisé dans un même magasin = doublon refusé).
 *
 * Additif et non destructif :
 *  - colonne NULLABLE (ADD COLUMN IF NOT EXISTS) ;
 *  - backfill des lignes existantes avec `lower(trim(name))` (les accents NE sont PAS
 *    repliés côté SQL sans extension `unaccent` ; les nouvelles écritures, elles, passent
 *    par `normalizeName()` JS qui replie les accents — cohérence totale sur les writes futurs ;
 *    voir TD-066-LEGACY-BACKFILL pour un backfill accent-insensible des lignes héritées) ;
 *  - index NON unique `(store_id, normalized_name)` pour accélérer la vérification de doublon
 *    (pas d'unique : les lignes legacy NULL/non repliées ne doivent pas faire échouer la migration).
 *
 * Réversible : `down` supprime l'index puis la colonne.
 */
export class AddProductNormalizedName1722000000000 implements MigrationInterface {
  name = 'AddProductNormalizedName1722000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS normalized_name varchar`,
    );
    await queryRunner.query(
      `UPDATE products SET normalized_name = lower(trim(name)) WHERE normalized_name IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_products_store_normalized_name ON products (store_id, normalized_name)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_products_store_normalized_name`,
    );
    await queryRunner.query(
      `ALTER TABLE products DROP COLUMN IF EXISTS normalized_name`,
    );
  }
}
