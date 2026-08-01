import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P0 — répare la dérive de schéma sur `pos_sessions` qui fait échouer en 500
 * TOUTE requête de session (ouverture ET lecture de session active), donc la
 * réouverture de caisse (« serveur ne répond pas » côté POS).
 *
 * Cause : plusieurs colonnes de `pos_sessions` n'existent QUE dans le `CREATE
 * TABLE IF NOT EXISTS` initial (jamais dans un `ALTER … ADD COLUMN`). Si la table
 * prod a été créée par un `synchronize` antérieur — avant que ces colonnes ne
 * soient ajoutées à l'entité — le `CREATE TABLE IF NOT EXISTS` ultérieur est un
 * NO-OP et la colonne n'est jamais posée. TypeORM `findOne`/`save` SELECT/INSERT
 * alors une colonne inexistante → PostgreSQL `42703` → 500 sur `/pos-sessions/open`
 * et `/pos-sessions/active`. (Colonne pointée par la sonde terrain :
 * `timewin_session_token`.)
 *
 * Correctif : `ADD COLUMN IF NOT EXISTS` pour toutes les colonnes de l'entité qui
 * ne sont couvertes par AUCUN `ALTER` — 100 % ADDITIF, réversible, sans perte,
 * idempotent (no-op si la colonne existe déjà). Aucune donnée réécrite, aucune
 * surface fiscale touchée. Les colonnes NOT NULL de l'entité (`store_id`,
 * `employee_id`, `employee_name`, `employee_role`, `opened_at`) ne sont PAS
 * ajoutées ici : elles précèdent la colonne fautive dans l'ordre de SELECT et
 * existent donc déjà (sinon la lecture aurait échoué avant) ; les créer avec un
 * défaut arbitraire sur des lignes existantes serait faux.
 */
export class EnsurePosSessionColumns1776000000000 implements MigrationInterface {
  name = 'EnsurePosSessionColumns1776000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Colonne directement pointée par la sonde ET reproduite en local (42703 :
    // « column PosSessionEntity.timewin_session_token does not exist ») — LA cause.
    await queryRunner.query(
      `ALTER TABLE "pos_sessions" ADD COLUMN IF NOT EXISTS "timewin_session_token" varchar`,
    );
    // Autres colonnes de l'entité présentes UNIQUEMENT dans le CREATE TABLE (aucun
    // ALTER) — noms RÉELS des colonnes, défaut sûr/nullable, défense en profondeur.
    // (La sonde a échoué sur timewin_session_token, donc les colonnes qui la
    //  précèdent — dont "permissions" — existent déjà ; ces ADD sont des no-op si
    //  présentes, jamais destructeurs.)
    await queryRunner.query(
      `ALTER TABLE "pos_sessions" ADD COLUMN IF NOT EXISTS "permissions" jsonb NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "pos_sessions" ADD COLUMN IF NOT EXISTS "max_discount" numeric NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "pos_sessions" ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "pos_sessions" ADD COLUMN IF NOT EXISTS "offline_mode" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "pos_sessions" ADD COLUMN IF NOT EXISTS "closed_at" timestamp`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Réversible : on retire uniquement ce que ce correctif a pu ajouter.
    // (No-op si les colonnes préexistaient — DROP IF EXISTS reste sûr, mais on se
    //  limite à la colonne fautive pour ne pas supprimer des colonnes légitimes.)
    await queryRunner.query(
      `ALTER TABLE "pos_sessions" DROP COLUMN IF EXISTS "timewin_session_token"`,
    );
  }
}
