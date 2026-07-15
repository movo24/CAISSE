import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Table `user_view_events` : journal des consultations (télémétrie métier).
 * metadata_json nettoyé + borné côté service. Aucun secret.
 * 100 % ADDITIVE et réversible. N'altère ni ventes, ni paiements, ni stock.
 */
export class CreateUserViewEvents1759000000005 implements MigrationInterface {
  name = 'CreateUserViewEvents1759000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_view_events (
        id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        user_id varchar,
        employee_id varchar,
        session_id varchar,
        store_id varchar,
        module varchar,
        screen varchar,
        entity_type varchar,
        entity_id varchar,
        action varchar(64) NOT NULL,
        source_route varchar,
        duration_ms int,
        metadata_json jsonb,
        ip_address varchar,
        device_type varchar,
        occurred_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_uve_employee_time ON user_view_events(employee_id, occurred_at)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_uve_store_time ON user_view_events(store_id, occurred_at)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS user_view_events CASCADE`);
  }
}
