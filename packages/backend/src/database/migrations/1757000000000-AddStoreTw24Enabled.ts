import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Toggle TimeWin24 par magasin (Partie C).
 *
 * `stores.tw24_enabled` : interrupteur d'activation de la remontée d'événements
 * TW24 (ventes, sessions, pointage, stock) POUR CE MAGASIN. **Défaut `false`**
 * — rien n'est natif, tout est optionnel : un magasin active TW24 consciemment.
 *
 * ⚠️ En passant les magasins à `false` par défaut, l'exécution de cette
 * migration rend la synchro TW24 OPT-IN : les magasins qui souhaitaient
 * remonter des événements devront activer l'interrupteur. Additive et
 * réversible ; n'altère ni les ventes, ni la chaîne de hash, ni le journal
 * fiscal. **Écrite, NON exécutée** — attend un GO explicite.
 */
export class AddStoreTw24Enabled1757000000000 implements MigrationInterface {
  name = 'AddStoreTw24Enabled1757000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "tw24_enabled" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "stores" DROP COLUMN IF EXISTS "tw24_enabled"`,
    );
  }
}
