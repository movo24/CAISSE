import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Table `user_login_events` : journal des connexions (télémétrie). Aucun secret stocké.
 * Géo approximative dérivée de l'IP uniquement (jamais GPS continu).
 * 100 % ADDITIVE et réversible. N'altère ni ventes, ni paiements, ni stock.
 */
export class CreateUserLoginEvents1759000000003 implements MigrationInterface {
  name = 'CreateUserLoginEvents1759000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_login_events (
        id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        user_id varchar,
        employee_id varchar,
        session_id varchar,
        event_type varchar(32) NOT NULL,
        success boolean NOT NULL DEFAULT true,
        failure_reason varchar,
        authentication_method varchar(32),
        ip_address varchar,
        ip_hash varchar,
        country_code varchar(8),
        region varchar,
        city varchar,
        approximate_latitude double precision,
        approximate_longitude double precision,
        user_agent text,
        device_type varchar,
        device_name varchar,
        operating_system varchar,
        browser varchar,
        application_version varchar,
        is_new_device boolean NOT NULL DEFAULT false,
        risk_score int NOT NULL DEFAULT 0,
        occurred_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_ule_employee_time ON user_login_events(employee_id, occurred_at)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_ule_success_time ON user_login_events(success, occurred_at)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS user_login_events CASCADE`);
  }
}
