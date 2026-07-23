import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Catalogue — Lot 2 : champs additifs de la fiche produit professionnelle.
 *
 * 100% ADDITIF et RÉVERSIBLE (aucune colonne existante modifiée, aucune donnée
 * réécrite). Débloque les onglets « Phase 2 » de la fiche (identification,
 * logistique, achat) sans toucher la surface vente/fiscale.
 *
 * Inclut le correctif G2 : `price_history` reçoit `store_id`, `change_source`,
 * `changed_by_role` — colonnes que l'entité écrit déjà mais que la table n'avait
 * pas (l'override de prix magasin plantait en prod, historique perdu en silence).
 */
export class AddCatalogPhase2Fields1760000000000 implements MigrationInterface {
  name = 'AddCatalogPhase2Fields1760000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Identification ──
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "short_name" varchar(120)`);
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "internal_ref" varchar(100)`);
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "supplier_ref" varchar(100)`);
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "product_type" varchar(20) NOT NULL DEFAULT 'simple'`);
    // ── Achat / logistique fournisseur ──
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "country_of_origin" varchar(80)`);
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "lead_time_days" integer`);
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "min_order_quantity" integer`);
    // ── Logistique physique ──
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "weight_grams" integer`);
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "width_mm" integer`);
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "height_mm" integer`);
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "depth_mm" integer`);
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "volume_ml" integer`);
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "units_per_carton" integer`);
    // Index de tri par type (filtre catalogue à venir).
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_products_product_type" ON "products" ("product_type")`);

    // ── G2 : aligner price_history sur ce que l'entité écrit déjà ──
    await queryRunner.query(`ALTER TABLE "price_history" ADD COLUMN IF NOT EXISTS "store_id" varchar`);
    await queryRunner.query(`ALTER TABLE "price_history" ADD COLUMN IF NOT EXISTS "change_source" varchar`);
    await queryRunner.query(`ALTER TABLE "price_history" ADD COLUMN IF NOT EXISTS "changed_by_role" varchar`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "price_history" DROP COLUMN IF EXISTS "changed_by_role"`);
    await queryRunner.query(`ALTER TABLE "price_history" DROP COLUMN IF EXISTS "change_source"`);
    await queryRunner.query(`ALTER TABLE "price_history" DROP COLUMN IF EXISTS "store_id"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_products_product_type"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "units_per_carton"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "volume_ml"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "depth_mm"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "height_mm"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "width_mm"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "weight_grams"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "min_order_quantity"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "lead_time_days"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "country_of_origin"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "product_type"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "supplier_ref"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "internal_ref"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "short_name"`);
  }
}
