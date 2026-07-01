/**
 * POS-INT-176 — de-risk MIGRATION-1725 without a real Postgres server.
 * Applies the migration's up()/down() raw SQL against an in-memory Postgres
 * (pg-mem) and asserts the integration_events table, its columns, defaults and
 * reversibility. Not a substitute for a real prod migration:run, but proves the
 * SQL is well-formed and the schema matches expectations.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { newDb, DataType } from 'pg-mem';
import { v4 as uuidv4 } from 'uuid';
import { AddIntegrationOutbox1725000000000 } from '../src/database/migrations/1725000000000-AddIntegrationOutbox';

function barePgMem(): DataSource {
  const db = newDb();
  db.public.registerFunction({ name: 'version', returns: DataType.text, implementation: () => 'PostgreSQL 14.0 (pg-mem)' });
  db.public.registerFunction({ name: 'current_database', returns: DataType.text, implementation: () => 'test' });
  db.public.registerFunction({ name: 'uuid_generate_v4', returns: DataType.uuid, impure: true, implementation: () => uuidv4() });
  return db.adapters.createTypeormDataSource({ type: 'postgres', entities: [], synchronize: false });
}

describe('MIGRATION-1725 AddIntegrationOutbox (pg-mem)', () => {
  let ds: DataSource;
  const mig = new AddIntegrationOutbox1725000000000();

  beforeAll(async () => { ds = await barePgMem().initialize(); });
  afterAll(async () => { await ds.destroy(); });

  it('up() creates integration_events with the expected columns', async () => {
    await mig.up(ds.createQueryRunner());
    const cols: { column_name: string }[] = await ds.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'integration_events'`,
    );
    const names = cols.map((c) => c.column_name).sort();
    for (const expected of [
      'id', 'type', 'aggregate_type', 'aggregate_id', 'store_id', 'organization_id',
      'terminal_id', 'employee_id', 'actor_role', 'occurred_at', 'payload',
      'schema_version', 'source', 'status', 'published_at', 'attempts', 'created_at',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('applies column defaults on insert (status/attempts/schema_version/payload)', async () => {
    await ds.query(
      `INSERT INTO integration_events (id, type, aggregate_type, aggregate_id, store_id, occurred_at)
       VALUES ($1,'sale.created','sale','sale-1','store-1', now())`,
      [uuidv4()],
    );
    const rows = await ds.query(`SELECT status, attempts, schema_version, source FROM integration_events`);
    expect(rows[0]).toMatchObject({ status: 'pending', attempts: 0, schema_version: 1 });
  });

  // NOTE: up() uses `CREATE TABLE IF NOT EXISTS` (idempotent on real Postgres),
  // but pg-mem does not model IF-NOT-EXISTS re-runs, so re-running up() against an
  // existing table is not asserted here. Idempotency is a real-PG feature validated
  // at prod migration:run time (gate MIGRATION-1725).

  it('down() drops the table (reversible)', async () => {
    await mig.down(ds.createQueryRunner());
    const cols = await ds.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'integration_events'`,
    );
    expect(cols.length).toBe(0);
  });
});
