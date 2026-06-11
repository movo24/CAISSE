/**
 * DB-level γ invariant — partial unique index enforcement.
 *
 * The service's check-then-insert alone would be a TOCTOU race: two
 * concurrent opens on the same terminal could both pass the check and both
 * insert. The partial unique index (uq_pos_sessions_store_terminal_active
 * in migration 1719; declared on the entity for synchronize-based test DBs)
 * makes the second insert fail atomically at the DB level.
 *
 * These tests bypass the service entirely (raw SQL) to prove the constraint
 * fires in the DATABASE, not in application code. Sequential service-level
 * tests can't catch the race; this is the structural backstop's own test.
 */
import './helpers/env-setup';
import { DataSource } from 'typeorm';
import { createPgMemDataSource } from './helpers/pgmem';

describe('PosSession — DB-level γ invariant (partial unique index)', () => {
  let ds: DataSource;

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    // The pgmem helper configures synchronize: true — initialize() builds the
    // schema from entities, including the partial unique index. Do NOT call
    // ds.synchronize() again: the second pass runs schema introspection that
    // pg-mem does not support.
    ds = await dataSource.initialize();
  });

  afterAll(async () => {
    await ds.destroy();
  });

  it('rejects two ACTIVE sessions for the same (store, terminal) — raw SQL, no service', async () => {
    await ds.query(
      `INSERT INTO pos_sessions (store_id, employee_id, terminal_id, employee_name, employee_role, is_active)
       VALUES ('s1','e1','t1','A','admin',true)`,
    );
    await expect(
      ds.query(
        `INSERT INTO pos_sessions (store_id, employee_id, terminal_id, employee_name, employee_role, is_active)
         VALUES ('s1','e2','t1','B','admin',true)`,
      ),
    ).rejects.toThrow();
  });

  it('allows an INACTIVE and an ACTIVE session to coexist on the same (store, terminal) — relève history', async () => {
    await ds.query(
      `INSERT INTO pos_sessions (store_id, employee_id, terminal_id, employee_name, employee_role, is_active)
       VALUES ('s2','e1','t2','A','admin',false)`,
    );
    // The partial index only covers is_active rows: closed history does not
    // block a new active session on the same terminal.
    await ds.query(
      `INSERT INTO pos_sessions (store_id, employee_id, terminal_id, employee_name, employee_role, is_active)
       VALUES ('s2','e2','t2','B','admin',true)`,
    );
  });
});
