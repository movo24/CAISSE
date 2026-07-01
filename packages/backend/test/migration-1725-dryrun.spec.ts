/**
 * POS-INT-207 — MIGRATION-1725 dry-run via the REAL TypeORM migration runner,
 * on a throwaway in-memory Postgres (pg-mem). Exercises ds.runMigrations() +
 * ds.undoLastMigration() (bookkeeping table + transaction), not just up()/down()
 * directly (that is P176). NEVER touches a real/target DB. No secret, no prod.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { newDb, DataType } from 'pg-mem';
import { v4 as uuidv4 } from 'uuid';
import { AddIntegrationOutbox1725000000000 } from '../src/database/migrations/1725000000000-AddIntegrationOutbox';

function throwawayPgMem(): DataSource {
  const db = newDb();
  db.public.registerFunction({ name: 'version', returns: DataType.text, implementation: () => 'PostgreSQL 14.0 (pg-mem)' });
  db.public.registerFunction({ name: 'current_database', returns: DataType.text, implementation: () => 'throwaway' });
  db.public.registerFunction({ name: 'uuid_generate_v4', returns: DataType.uuid, impure: true, implementation: () => uuidv4() });
  return db.adapters.createTypeormDataSource({
    type: 'postgres',
    entities: [],
    synchronize: false,
    migrationsRun: false,
    migrations: [AddIntegrationOutbox1725000000000],
  });
}

describe('MIGRATION-1725 dry-run (real TypeORM runner, pg-mem throwaway)', () => {
  let ds: DataSource;
  beforeAll(async () => { ds = await throwawayPgMem().initialize(); });
  afterAll(async () => { await ds.destroy(); });

  it('runMigrations() applies exactly the pending migration', async () => {
    const applied = await ds.runMigrations();
    expect(applied.map((m) => m.name)).toContain('AddIntegrationOutbox1725000000000');
    const cols = await ds.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'integration_events'`,
    );
    expect(cols.length).toBeGreaterThanOrEqual(17);
  });

  it('is idempotent at the runner level: a second run applies nothing (no drift)', async () => {
    const applied = await ds.runMigrations();
    expect(applied).toHaveLength(0); // already recorded → no re-apply, no drift
  });

  it('undoLastMigration() rolls back cleanly (reversible)', async () => {
    await ds.undoLastMigration();
    const cols = await ds.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'integration_events'`,
    );
    expect(cols.length).toBe(0);
  });
});
