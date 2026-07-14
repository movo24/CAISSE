import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Enrichit `employee_store_access` (créée en 1711000000000) pour le pilotage réseau.
 *
 * Ajoute les permissions granulaires par (employé, magasin), la fenêtre de validité
 * (accès temporaire), la traçabilité d'attribution et la révocation soft-delete.
 *
 * 100 % ADDITIVE et réversible : `ADD COLUMN IF NOT EXISTS` uniquement, aucune donnée
 * réécrite, aucune contrainte existante supprimée. L'UNIQUE(employee_id, store_id) posé
 * en 1711 reste la garantie « pas deux affectations actives identiques » (la révocation
 * est un soft-delete in-place via `revoked_at`, pas une suppression de ligne).
 * N'altère ni ventes, ni paiements, ni stock, ni la chaîne de hash fiscale.
 */
export class EnrichEmployeeStoreAccess1759000000000 implements MigrationInterface {
  name = 'EnrichEmployeeStoreAccess1759000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const t = 'employee_store_access';
    // Rôle applicatif de l'affectation
    await queryRunner.query(`ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS "access_role" varchar(50)`);
    // Permissions granulaires
    await queryRunner.query(`ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS "can_view_dashboard" boolean NOT NULL DEFAULT true`);
    await queryRunner.query(`ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS "can_view_financials" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS "can_view_employees" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS "can_view_alerts" boolean NOT NULL DEFAULT true`);
    await queryRunner.query(`ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS "can_compare" boolean NOT NULL DEFAULT false`);
    // Fenêtre de validité (accès temporaire) — null = pas de borne
    await queryRunner.query(`ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS "valid_from" timestamp`);
    await queryRunner.query(`ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS "valid_until" timestamp`);
    // Traçabilité d'attribution
    await queryRunner.query(`ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS "granted_by" uuid`);
    await queryRunner.query(`ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS "granted_reason" text`);
    // Révocation soft-delete in-place
    await queryRunner.query(`ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS "revoked_at" timestamp`);
    await queryRunner.query(`ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS "revoked_by" uuid`);
    await queryRunner.query(`ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now()`);
    // Index partiel : accélère la résolution du périmètre actif (révoqué = exclu)
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_esa_active" ON "${t}" ("store_id", "employee_id") WHERE "revoked_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const t = 'employee_store_access';
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_esa_active"`);
    for (const col of [
      'updated_at',
      'revoked_by',
      'revoked_at',
      'granted_reason',
      'granted_by',
      'valid_until',
      'valid_from',
      'can_compare',
      'can_view_alerts',
      'can_view_employees',
      'can_view_financials',
      'can_view_dashboard',
      'access_role',
    ]) {
      await queryRunner.query(`ALTER TABLE "${t}" DROP COLUMN IF EXISTS "${col}"`);
    }
  }
}
