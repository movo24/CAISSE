import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Codes-barres internes Wesley (environnement fermé, reconnu par GS1) :
 *
 * - séquence `wesley_product_code_seq` : source UNIQUE des identifiants
 *   internes `WES-P-############`. Atomique (nextval), monotone, jamais
 *   recyclée (NO CYCLE) — deux créations simultanées ne peuvent pas obtenir
 *   le même numéro, et un numéro consommé n'est JAMAIS réattribué, même si
 *   le produit est archivé ou si l'assistant est abandonné ;
 * - `products.barcode_type` : distinction explicite entre un code fabricant
 *   officiel (`EXTERNAL_GTIN`) et un identifiant interne (`INTERNAL_WESLEY`),
 *   rendu en Code 128 standard non-GS1 (jamais un faux EAN-13).
 *
 * Migration STRICTEMENT additive — aucune donnée existante modifiée
 * (backfill : tout l'existant est un code fabricant).
 */
export class AddInternalWesleyCodes1773000000000 implements MigrationInterface {
  name = 'AddInternalWesleyCodes1773000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE SEQUENCE IF NOT EXISTS wesley_product_code_seq START WITH 1 INCREMENT BY 1 NO CYCLE`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "barcode_type" character varying(20) NOT NULL DEFAULT 'EXTERNAL_GTIN'`,
    );
    // Sécurité : si des codes internes existaient déjà (aucun attendu), les classer.
    await queryRunner.query(
      `UPDATE "products" SET "barcode_type" = 'INTERNAL_WESLEY' WHERE "ean" LIKE 'WES-P-%'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "barcode_type"`);
    // Dev uniquement : en production la séquence ne doit jamais être supprimée
    // (un numéro déjà émis ne doit jamais pouvoir être réattribué).
    await queryRunner.query(`DROP SEQUENCE IF EXISTS wesley_product_code_seq`);
  }
}
