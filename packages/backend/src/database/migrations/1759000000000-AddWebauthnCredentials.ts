import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P370 — Passkeys WebAuthn/FIDO2 : table des credentials PUBLIQUES.
 * Aucune clé privée, aucune donnée biométrique — uniquement ce qu'exige la
 * vérification cryptographique (credential id, clé publique COSE, compteur).
 * Additive et idempotente. Timestamp 1759 = strictement au-dessus de la
 * dernière migration officielle (1758-AddStoreGeoAndNetwork sur origin/main)
 * → s'exécute EN DERNIER sur la lignée cible. Contenu auto-suffisant
 * (CREATE TABLE + uuid-ossp uniquement) : indépendant des autres migrations.
 * ⚠️ NON exécutée en production (attend GO). NE PAS confondre avec le vieux
 * run-gate2.sh (figé sur 1725→1728, lignée obsolète).
 */
export class AddWebauthnCredentials1759000000000 implements MigrationInterface {
  name = 'AddWebauthnCredentials1759000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "webauthn_credentials" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "employee_id" uuid NOT NULL,
        "credential_id" text NOT NULL,
        "public_key" text NOT NULL,
        "counter" bigint NOT NULL DEFAULT 0,
        "transports" character varying,
        "device_name" character varying(100) NOT NULL,
        "device_type" character varying,
        "backed_up" boolean NOT NULL DEFAULT false,
        "aaguid" character varying,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "last_used_at" TIMESTAMP,
        "revoked_at" TIMESTAMP,
        CONSTRAINT "PK_webauthn_credentials" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_webauthn_credential_id" ON "webauthn_credentials" ("credential_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_webauthn_employee" ON "webauthn_credentials" ("employee_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "webauthn_credentials"`);
  }
}
