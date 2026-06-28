import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * POS-073 — plafond d'usage des promotions : `promo_rules.usage_limit` (null = illimité)
 * et `promo_rules.usage_count` (compteur, défaut 0).
 *
 * Additif et non destructif : colonnes nullable / avec défaut (ADD COLUMN IF NOT EXISTS).
 * Tant que `usage_limit` est NULL, aucun changement de comportement (promo illimitée).
 * La filtration d'exclusion (promo au plafond → exclue) est faite dans `getActivePromos`.
 *
 * Réversible : `down` supprime les deux colonnes.
 */
export class AddPromoUsageLimit1724000000000 implements MigrationInterface {
  name = 'AddPromoUsageLimit1724000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE promo_rules ADD COLUMN IF NOT EXISTS usage_limit integer`,
    );
    await queryRunner.query(
      `ALTER TABLE promo_rules ADD COLUMN IF NOT EXISTS usage_count integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE promo_rules DROP COLUMN IF EXISTS usage_count`);
    await queryRunner.query(`ALTER TABLE promo_rules DROP COLUMN IF EXISTS usage_limit`);
  }
}
