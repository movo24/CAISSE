import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Produit inconnu scanné — intégration sécurisée (Dashboard / Inventaire).
 *
 * 1. `products.status` : cycle de vie de la fiche
 *    (draft | pending_validation | active | rejected | archived).
 *    Additif, défaut 'active' → les produits existants restent vendables,
 *    aucune donnée réécrite.
 * 2. `product_integration_requests` : demandes d'intégration produit créées
 *    au scan d'un code-barres inconnu (la caisse ne crée JAMAIS de produit,
 *    seulement une demande).
 */
export class AddProductStatusAndIntegrationRequests1746000000000
  implements MigrationInterface
{
  name = 'AddProductStatusAndIntegrationRequests1746000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "status" character varying NOT NULL DEFAULT 'active'`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "product_integration_requests" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "store_id" uuid NOT NULL,
        "barcode" character varying NOT NULL,
        "source" character varying NOT NULL DEFAULT 'pos',
        "terminal_id" character varying,
        "requested_by" character varying NOT NULL,
        "status" character varying NOT NULL DEFAULT 'pending',
        "proposal" jsonb,
        "comment" character varying,
        "decided_by" character varying,
        "decided_at" TIMESTAMP,
        "rejection_reason" character varying,
        "product_id" uuid,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_product_integration_requests" PRIMARY KEY ("id"),
        CONSTRAINT "FK_pir_store" FOREIGN KEY ("store_id")
          REFERENCES "stores"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_pir_store_status" ON "product_integration_requests" ("store_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_pir_store_barcode" ON "product_integration_requests" ("store_id", "barcode")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "product_integration_requests"`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" DROP COLUMN IF EXISTS "status"`,
    );
  }
}
