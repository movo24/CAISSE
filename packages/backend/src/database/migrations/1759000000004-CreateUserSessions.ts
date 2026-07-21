import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Table `user_sessions` : sessions d'AUTHENTIFICATION (distincte de pos_sessions).
 * Permet lister/révoquer les sessions actives. Aucun token stocké.
 * 100 % ADDITIVE et réversible. N'altère ni ventes, ni paiements, ni stock.
 */
export class CreateUserSessions1759000000004 implements MigrationInterface {
  name = 'CreateUserSessions1759000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        user_id varchar,
        employee_id varchar,
        started_at timestamp NOT NULL DEFAULT now(),
        last_activity_at timestamp,
        ended_at timestamp,
        end_reason varchar,
        ip_address varchar,
        country_code varchar(8),
        region varchar,
        city varchar,
        device_fingerprint varchar,
        device_type varchar,
        operating_system varchar,
        browser varchar,
        application_version varchar,
        revoked_at timestamp,
        revoked_by varchar,
        revoke_reason varchar
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_us_employee_started ON user_sessions(employee_id, started_at)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS user_sessions CASCADE`);
  }
}
