import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { createPgMemDataSource } from './helpers/pgmem';
import { AddSalePosSessionId1726000000000 } from '../src/database/migrations/1726000000000-AddSalePosSessionId';

// P319 (cycle I2) — migration 1726 dry-run on a genuine SQL engine:
// up() adds the nullable column + index without touching existing rows,
// is IDEMPOTENT (IF NOT EXISTS → double-up harmless), and down() reverts.
// ⚠️ Running on the TARGET DB stays gated (GATE 2) — see MIGRATION_RUNBOOK.md.

describe('migration 1726-AddSalePosSessionId — dry-run (pg-mem)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    const built = createPgMemDataSource();
    dataSource = built.dataSource;
    await dataSource.initialize();
    // Simulate the PRE-migration schema: drop what synchronize created.
    await dataSource.query(`ALTER TABLE "sales" DROP COLUMN IF EXISTS "pos_session_id"`);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('up() adds the nullable column; existing rows keep NULL; re-running up() is harmless (idempotent)', async () => {
    // seed a pre-migration sale (raw SQL — the entity has the column, the table does not yet)
    const saleId = uuidv4();
    await dataSource.query(
      `INSERT INTO sales (id, store_id, employee_id, status, ticket_number, total_minor_units)
       VALUES ($1, $2, $3, 'completed', 'T-MIG-1', 100)`,
      [saleId, uuidv4(), uuidv4()],
    );

    const mig = new AddSalePosSessionId1726000000000();
    await mig.up(dataSource.createQueryRunner());
    await mig.up(dataSource.createQueryRunner()); // idempotence (IF NOT EXISTS)

    const rows = await dataSource.query(`SELECT pos_session_id FROM sales WHERE id = $1`, [saleId]);
    expect(rows[0].pos_session_id).toBeNull(); // legacy row untouched

    // the column accepts a uuid and NULL (nullable by design)
    await dataSource.query(`UPDATE sales SET pos_session_id = $1 WHERE id = $2`, [uuidv4(), saleId]);
    await dataSource.query(`UPDATE sales SET pos_session_id = NULL WHERE id = $1`, [saleId]);
  });

  it('down() reverts cleanly (column gone), and is also idempotent', async () => {
    const mig = new AddSalePosSessionId1726000000000();
    await mig.down(dataSource.createQueryRunner());
    await mig.down(dataSource.createQueryRunner()); // IF EXISTS → harmless

    const cols: Array<{ column_name: string }> = await dataSource.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'sales'`,
    );
    expect(cols.map((c) => c.column_name)).not.toContain('pos_session_id');
  });
});
