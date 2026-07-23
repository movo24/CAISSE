import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Catalogue — Lot I : derniers champs « niveau ERP distribution ».
 * ADDITIF + RÉVERSIBLE. Prix min autorisé + prix conseillé ; conditionnement
 * (colis/palette) ; réglementaire alimentaire (allergènes, ingrédients, DDM/DLC,
 * n° de lot). Aucune surface vente/fiscale touchée.
 */
export class AddRemainingCatalogFields1766000000000 implements MigrationInterface {
  name = 'AddRemainingCatalogFields1766000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Prix.
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "min_price_minor_units" integer`);
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "recommended_price_minor_units" integer`);
    // Conditionnement (units_per_carton existe déjà — Lot 2).
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "units_per_pack" integer`);
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "cartons_per_pallet" integer`);
    // Réglementaire / alimentaire.
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "allergens" text`);
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "ingredients" text`);
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "best_before_date" date`);
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "use_by_date" date`);
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "lot_number" varchar(60)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "lot_number"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "use_by_date"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "best_before_date"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "ingredients"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "allergens"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "cartons_per_pallet"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "units_per_pack"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "recommended_price_minor_units"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "min_price_minor_units"`);
  }
}
