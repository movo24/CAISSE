import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Curseur fiscal monotone par magasin — `sales.sale_seq` (ADR-012).
 *
 * Le `ticket_number` est une chaîne zéro-paddée (`T-000006`). Trier la chaîne de
 * hash par cette chaîne est un tri LEXICAL : il n'égale le tri numérique que
 * jusqu'à 6 chiffres. À la 1 000 000ᵉ vente d'un magasin, `T-1000000` se classe
 * AVANT `T-999999` → le générateur recalcule 1000000 (ticket DUPLIQUÉ) et le
 * `prevHash` lit la mauvaise tête de chaîne (FORK fiscal). On ajoute un curseur
 * entier (`sale_seq`) ordonné numériquement : générateur et tête de chaîne
 * pointent dessus, la chaîne reste correcte au-delà de 1 000 000.
 *
 * Additif et non destructif :
 *  - colonne NULLABLE (ADD COLUMN IF NOT EXISTS) — sûr même si des lignes
 *    existent ; les ventes synchronisées hors-ligne (numéro de ticket client,
 *    pas de seq) restent NULL et hors de la chaîne en ligne ;
 *  - backfill UNIQUEMENT des tickets canoniques `^T-[0-9]+$`, depuis leur
 *    suffixe entier — `ticket_number` n'est JAMAIS réécrit (immuabilité NF525) ;
 *  - garde pré-déploiement « SELECT-null » : on REFUSE la migration (RAISE →
 *    rollback transactionnel) si une vente canonique reste sans seq, plutôt que
 *    de déployer un curseur à moitié rempli ;
 *  - index unique PARTIEL (sale_seq IS NOT NULL) — backstop structurel contre un
 *    seq dupliqué par magasin (comme uq_pos_sessions_store_terminal_active) ; sa
 *    création échoue bruyamment si une collision latente existe, au lieu de
 *    corrompre silencieusement la chaîne.
 */
export class AddSaleSeqCursor1720000000000 implements MigrationInterface {
  name = 'AddSaleSeqCursor1720000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Colonne additive, nullable.
    await queryRunner.query(
      `ALTER TABLE sales ADD COLUMN IF NOT EXISTS sale_seq bigint`,
    );

    // 2. Backfill depuis le suffixe entier des seuls tickets canoniques.
    //    Idempotent (WHERE sale_seq IS NULL) → réexécutable sans effet de bord.
    await queryRunner.query(
      `UPDATE sales
          SET sale_seq = CAST(SUBSTRING(ticket_number FROM '[0-9]+$') AS bigint)
        WHERE ticket_number ~ '^T-[0-9]+$'
          AND sale_seq IS NULL`,
    );

    // 3. Garde « SELECT-null » : aucune vente canonique ne doit rester sans seq.
    //    RAISE → la transaction de migration est annulée (curseur jamais
    //    déployé à moitié).
    await queryRunner.query(`
      DO $$
      DECLARE missing bigint;
      BEGIN
        SELECT count(*) INTO missing
          FROM sales
         WHERE ticket_number ~ '^T-[0-9]+$'
           AND sale_seq IS NULL;
        IF missing > 0 THEN
          RAISE EXCEPTION
            'AddSaleSeqCursor gate: % canonical sale(s) without sale_seq — backfill incomplete, refusing to deploy', missing;
        END IF;
      END $$;
    `);

    // 4. Index unique partiel — un seq unique par magasin (backstop structurel).
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_store_sale_seq
         ON sales(store_id, sale_seq)
         WHERE sale_seq IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uq_sales_store_sale_seq`);
    await queryRunner.query(`ALTER TABLE sales DROP COLUMN IF EXISTS sale_seq`);
  }
}
