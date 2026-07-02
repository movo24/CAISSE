import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P351 — POS-016 / POS-017 : fond de caisse + comptage persisté.
 *
 * Trois colonnes NULLABLES (centimes, int) sur `pos_sessions` :
 *  - opening_float_minor_units  : fond de caisse déclaré à l'ouverture ;
 *  - counted_cash_minor_units   : espèces comptées à la clôture ;
 *  - cash_variance_minor_units  : écart signé figé à la clôture, calculé
 *    serveur = compté − (fond + espèces des ventes stampées de la session).
 *
 * Additive & réversible : les sessions existantes restent NULL (aucune
 * réécriture d'historique). ⚠️ NOT run on the target DB from the sandbox —
 * même file que 1725-1727 (GATE 2, cf MIGRATION_RUNBOOK).
 */
export class AddPosSessionCashFields1728000000000 implements MigrationInterface {
  name = 'AddPosSessionCashFields1728000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pos_sessions" ADD COLUMN IF NOT EXISTS "opening_float_minor_units" int NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "pos_sessions" ADD COLUMN IF NOT EXISTS "counted_cash_minor_units" int NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "pos_sessions" ADD COLUMN IF NOT EXISTS "cash_variance_minor_units" int NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "pos_sessions" DROP COLUMN IF EXISTS "cash_variance_minor_units"`);
    await queryRunner.query(`ALTER TABLE "pos_sessions" DROP COLUMN IF EXISTS "counted_cash_minor_units"`);
    await queryRunner.query(`ALTER TABLE "pos_sessions" DROP COLUMN IF EXISTS "opening_float_minor_units"`);
  }
}
