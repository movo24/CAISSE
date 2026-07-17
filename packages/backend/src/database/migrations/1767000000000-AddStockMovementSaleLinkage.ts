import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Journal de stock unifié — Bloc F0 (préparation additive, ZÉRO comportement).
 *
 * Prépare `stock_movements` (aujourd'hui écrit uniquement par l'entrepôt) à
 * devenir la source unique de vérité de TOUS les mouvements de stock (vente,
 * pack, retour, void, ajustement) — voir PRODUCTS_FISCAL_STOCK_SYNTHESIS.md.
 *
 * Ce bloc N'ÉCRIT AUCUN mouvement et NE MODIFIE AUCUN comportement : il ajoute
 * seulement les colonnes de liaison + index + la contrainte d'idempotence qui
 * seront exploitées au bloc F1 (écriture double / shadow). 100% additif et
 * réversible ; aucune colonne existante modifiée, aucune donnée réécrite,
 * AUCUNE surface fiscale (hash de vente, fiscal_journal, credit_notes, audit)
 * touchée. Rollback = DROP des colonnes/index ajoutés.
 *
 * Décisions owner (GO nommé) : `store_id` porté par le mouvement (pas
 * d'emplacement dédié) ; `occurred_at` = temps métier (chronologie offline).
 */
export class AddStockMovementSaleLinkage1767000000000 implements MigrationInterface {
  name = 'AddStockMovementSaleLinkage1767000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Colonnes de liaison (toutes nullable, sans défaut réécrivant) ──
    await queryRunner.query(`ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "store_id" uuid`);
    await queryRunner.query(`ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "sale_id" uuid`);
    await queryRunner.query(`ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "sale_line_item_id" uuid`);
    // Temps métier de l'opération (ex. heure réelle d'une vente rejouée offline),
    // distinct de created_at (temps d'enregistrement serveur).
    await queryRunner.query(`ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "occurred_at" timestamp`);

    // ── Index de lecture (mouvements par vente / historique magasin) ──
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_stock_movements_sale" ON "stock_movements" ("sale_id") WHERE "sale_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_stock_movements_store_created" ON "stock_movements" ("store_id", "created_at")`,
    );

    // ── Idempotence (défense en profondeur pour F1) : un seul mouvement par
    // (ligne de vente × produit × type). Ne concerne que les mouvements liés à
    // une vente ; les mouvements d'entrepôt (sale_id NULL) ne sont pas contraints.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_stock_movements_sale_line_product_type" ` +
        `ON "stock_movements" ("sale_line_item_id", "product_id", "movement_type") WHERE "sale_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_stock_movements_sale_line_product_type"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_stock_movements_store_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_stock_movements_sale"`);
    await queryRunner.query(`ALTER TABLE "stock_movements" DROP COLUMN IF EXISTS "occurred_at"`);
    await queryRunner.query(`ALTER TABLE "stock_movements" DROP COLUMN IF EXISTS "sale_line_item_id"`);
    await queryRunner.query(`ALTER TABLE "stock_movements" DROP COLUMN IF EXISTS "sale_id"`);
    await queryRunner.query(`ALTER TABLE "stock_movements" DROP COLUMN IF EXISTS "store_id"`);
  }
}
