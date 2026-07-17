import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Refonte ticket de caisse The Wesley — socle données (100% additif, réversible).
 *
 * 1. `stores` : réglages du ticket pilotés depuis le Dashboard (jamais codés en
 *    dur dans le moteur d'impression) — site web, logo (data-URL), réglages QR,
 *    zone recommandations, URL publique du ticket numérique. Tout est nullable :
 *    une donnée absente est affichée « information à compléter » dans l'admin et
 *    N'EST PAS imprimée sur le ticket.
 *
 * 2. `sales.public_token` : jeton public opaque du ticket numérique, généré
 *    serveur à la finalisation de la vente. Nullable et DÉLIBÉRÉMENT HORS de
 *    l'empreinte de hash fiscale (même modèle que session_id/terminal_id) : les
 *    ventes validées existantes ne sont JAMAIS réécrites ni rehashées — elles
 *    restent simplement sans QR. Index unique partiel (NULLs exclus).
 *
 * Numérotation : 1771 — saute 1768-1770 (réservés par feat/product-sheet-erp-pa,
 * non mergée) comme le saut 1719→1735 historique.
 *
 * Rollback = DROP des colonnes/index ajoutés ; aucune donnée existante touchée.
 */
export class AddReceiptSettingsAndPublicTicketToken1771000000000 implements MigrationInterface {
  name = 'AddReceiptSettingsAndPublicTicketToken1771000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── stores : réglages ticket (tous nullable / défauts non intrusifs) ──
    await queryRunner.query(`ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "website_url" varchar`);
    await queryRunner.query(`ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "receipt_logo_url" text`);
    await queryRunner.query(
      `ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "receipt_qr_enabled" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(`ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "receipt_qr_text" varchar`);
    await queryRunner.query(`ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "receipt_final_message" varchar`);
    await queryRunner.query(
      `ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "receipt_show_recommendations" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "receipt_recommendation_target" varchar`,
    );
    await queryRunner.query(
      `ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "receipt_recommendation_category_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "receipt_public_base_url" varchar`,
    );

    // ── sales : jeton public du ticket numérique (hors hash fiscal) ──
    await queryRunner.query(`ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "public_token" varchar(64)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UX_sales_public_token" ON "sales" ("public_token") WHERE "public_token" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UX_sales_public_token"`);
    await queryRunner.query(`ALTER TABLE "sales" DROP COLUMN IF EXISTS "public_token"`);

    await queryRunner.query(`ALTER TABLE "stores" DROP COLUMN IF EXISTS "receipt_public_base_url"`);
    await queryRunner.query(`ALTER TABLE "stores" DROP COLUMN IF EXISTS "receipt_recommendation_category_id"`);
    await queryRunner.query(`ALTER TABLE "stores" DROP COLUMN IF EXISTS "receipt_recommendation_target"`);
    await queryRunner.query(`ALTER TABLE "stores" DROP COLUMN IF EXISTS "receipt_show_recommendations"`);
    await queryRunner.query(`ALTER TABLE "stores" DROP COLUMN IF EXISTS "receipt_final_message"`);
    await queryRunner.query(`ALTER TABLE "stores" DROP COLUMN IF EXISTS "receipt_qr_text"`);
    await queryRunner.query(`ALTER TABLE "stores" DROP COLUMN IF EXISTS "receipt_qr_enabled"`);
    await queryRunner.query(`ALTER TABLE "stores" DROP COLUMN IF EXISTS "receipt_logo_url"`);
    await queryRunner.query(`ALTER TABLE "stores" DROP COLUMN IF EXISTS "website_url"`);
  }
}
