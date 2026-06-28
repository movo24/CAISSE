import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * POS-083 — baseline par/max de stock par produit (`products.stock_baseline_quantity`).
 *
 * Le seuil d'alerte « stock bas » devient relatif : 20 % de cette baseline. Décision
 * produit (2026-06-28) : « 20 % d'un par/max à ajouter ». La colonne est ADDITIVE et
 * NULLABLE — sûre même avec des lignes existantes : tant qu'elle est NULL, le code
 * retombe sur le seuil absolu `stock_alert_threshold` (aucun changement de comportement).
 *
 * Réversible : `down` supprime la colonne (IF EXISTS). Non destructif tant qu'aucune
 * baseline n'est remplie ; un rollback après remplissage perd uniquement les baselines
 * saisies (les seuils absolus restent la source de repli).
 */
export class AddStockBaseline1721000000000 implements MigrationInterface {
  name = 'AddStockBaseline1721000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_baseline_quantity integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE products DROP COLUMN IF EXISTS stock_baseline_quantity`,
    );
  }
}
