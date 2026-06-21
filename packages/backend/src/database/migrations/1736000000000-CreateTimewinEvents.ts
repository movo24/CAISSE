import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TimeWin24 idempotency — the timewin_events outbox/ledger. A UNIQUE
 * idempotency_key makes duplicate events (e.g. a re-sent session.opened)
 * impossible at the database level; a failed send stays retriable.
 */
export class CreateTimewinEvents1736000000000 implements MigrationInterface {
  name = 'CreateTimewinEvents1736000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS timewin_events (
        id               uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        idempotency_key  varchar(200) NOT NULL,
        event_type       varchar(50) NOT NULL,
        store_id         uuid NOT NULL,
        employee_id      uuid,
        status           varchar(20) NOT NULL DEFAULT 'pending',
        attempts         integer NOT NULL DEFAULT 0,
        last_error       varchar(500),
        created_at       timestamp DEFAULT now() NOT NULL,
        sent_at          timestamp
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_timewin_events_idempotency_key ON timewin_events(idempotency_key)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS timewin_events CASCADE`);
  }
}
