import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Répare la table `units` : colonnes opérationnelles jamais créées.
 *
 * `1710600000000-MultiEntityHierarchy` voulait créer `units` avec
 * `type`, `country`, `currency_code`, `notes` — mais `1700000000000-InitialSchema`
 * avait DÉJÀ créé une table `units` plus maigre (id, organization_id, name,
 * code, description, is_active, created_at, updated_at) : son
 * `CREATE TABLE IF NOT EXISTS` a no-opé. Résultat : l'entité UnitEntity, les
 * DTOs et la page Unités du backoffice référencent 4 colonnes fantômes, et
 * toute requête joignant la relation `unit` (ex. GET /api/stores/accessible)
 * échoue en `column ... does not exist`.
 *
 * Ces colonnes sont réellement voulues (DTOs validés, UI complète) → migration
 * ADDITIVE qui matérialise le schéma prévu par 1710600000000. Défauts
 * identiques à ceux d'origine ; aucune donnée existante modifiée ; réversible.
 * Ne touche ni ventes, ni chaîne de hash, ni journal fiscal.
 */
export class AddUnitOperationalColumns1772000000000 implements MigrationInterface {
  name = 'AddUnitOperationalColumns1772000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "units" ADD COLUMN IF NOT EXISTS "type" varchar NOT NULL DEFAULT 'retail'`,
    );
    await queryRunner.query(
      `ALTER TABLE "units" ADD COLUMN IF NOT EXISTS "country" varchar NOT NULL DEFAULT 'FR'`,
    );
    await queryRunner.query(
      `ALTER TABLE "units" ADD COLUMN IF NOT EXISTS "currency_code" varchar NOT NULL DEFAULT 'EUR'`,
    );
    await queryRunner.query(
      `ALTER TABLE "units" ADD COLUMN IF NOT EXISTS "notes" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "units" DROP COLUMN IF EXISTS "notes"`);
    await queryRunner.query(`ALTER TABLE "units" DROP COLUMN IF EXISTS "currency_code"`);
    await queryRunner.query(`ALTER TABLE "units" DROP COLUMN IF EXISTS "country"`);
    await queryRunner.query(`ALTER TABLE "units" DROP COLUMN IF EXISTS "type"`);
  }
}
