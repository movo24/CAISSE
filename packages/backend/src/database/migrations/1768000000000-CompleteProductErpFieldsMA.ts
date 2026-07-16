import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P-A / M-A — complétion des champs « fiche produit ERP » (schéma bd4179b, §M-A).
 *
 * ADDITIF + RÉVERSIBLE. Toutes les colonnes sont nullables ou pourvues d'un
 * DEFAULT ; aucune donnée existante n'est réécrite ; aucune surface vente/fiscale
 * n'est touchée. Complète l'existant (Lots 2/E/I : short_name, dims, colisage,
 * prix encadrés…) sans le dupliquer.
 *
 * Mapping spec ↔ existant (documenté, non redéveloppé) :
 *   - `internal_code` (spec)      → `internal_ref` déjà livré (Lot 2)
 *   - `upc` (spec)                → table `product_barcodes` déjà livrée (Lot A, plus riche)
 *   - `package_dims/pallet_dims`  → `units_per_carton/units_per_pack/cartons_per_pallet` (scalaires, Lots 2/I)
 *   - `weight_gross_g` (spec)     → `weight_grams` existant tenu pour le POIDS BRUT ; on ajoute `weight_net_g`
 *
 * `lifecycle_status` est AJOUTÉ distinct du `status` workflow existant
 * (draft/pending_validation/active/rejected/archived) — la spec l'exige
 * explicitement (« on ne le détourne pas »).
 */
export class CompleteProductErpFieldsMA1768000000000 implements MigrationInterface {
  name = 'CompleteProductErpFieldsMA1768000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Désignations / identification commerciale.
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "long_designation" varchar(300)`);
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "internal_description" text`);
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "receipt_description" varchar(80)`);
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "manufacturer" varchar(120)`);

    // Cycle de vie commercial — DISTINCT du workflow `status`.
    await queryRunner.query(
      `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "lifecycle_status" varchar(20) NOT NULL DEFAULT 'active'`,
    );

    // Poids net (le `weight_grams` existant est tenu pour le poids brut).
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "weight_net_g" integer`);

    // Planification de stock ERP (distincte des seuils d'alerte POS existants).
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "stock_reserved" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "stock_min" integer`);
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "stock_max" integer`);
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "stock_safety" integer`);

    // Emplacement magasin (marquage texte court ; complémentaire à stock_locations).
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "aisle" varchar(40)`);
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "shelf" varchar(40)`);
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "level" varchar(40)`);

    // Étiquettes libres.
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "tags" jsonb NOT NULL DEFAULT '[]'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "tags"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "level"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "shelf"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "aisle"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "stock_safety"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "stock_max"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "stock_min"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "stock_reserved"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "weight_net_g"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "lifecycle_status"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "manufacturer"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "receipt_description"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "internal_description"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "long_designation"`);
  }
}
