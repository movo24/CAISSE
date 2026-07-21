import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Table `access_audit_log` : journal d'audit des DROITS, immuable et hash-chaîné
 * (miroir du module `audit`). Append-only. L'index UNIQUE `(scope, previous_hash)`
 * empêche les forks de chaîne.
 *
 * 100 % ADDITIVE (nouvelle table) et réversible (DROP). N'altère ni ventes, ni
 * paiements, ni stock, ni la chaîne de hash fiscale.
 */
export class CreateAccessAuditLog1759000000002 implements MigrationInterface {
  name = 'CreateAccessAuditLog1759000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS access_audit_log (
        id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        scope varchar(64) NOT NULL DEFAULT 'global',
        actor_employee_id varchar NOT NULL,
        actor_user_id varchar,
        target_employee_id varchar,
        event_type varchar(40) NOT NULL,
        store_id varchar,
        previous_value jsonb,
        new_value jsonb,
        reason text,
        ip_address varchar,
        session_id varchar,
        previous_hash varchar NOT NULL,
        hash varchar NOT NULL,
        hashed_at varchar NOT NULL,
        occurred_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_aal_scope_occurred ON access_audit_log(scope, occurred_at)`,
    );
    // Anti-fork : une seule ligne par (scope, previous_hash).
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UX_access_scope_prevhash" ON access_audit_log(scope, previous_hash)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS access_audit_log CASCADE`);
  }
}
