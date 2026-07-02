import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { createPgMemDataSource } from './helpers/pgmem';
import { AddPosSessionCashFields1728000000000 } from '../src/database/migrations/1728000000000-AddPosSessionCashFields';

// P351 — migration 1728 dry-run sur moteur SQL réel : up() ajoute 3 colonnes
// nullables sans toucher aux sessions existantes, est idempotent, down() revert.
// ⚠️ Exécution sur la base CIBLE : file GATE 2 (cf MIGRATION_RUNBOOK / run-gate2.sh).

describe('migration 1728-AddPosSessionCashFields — dry-run (pg-mem)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    const built = createPgMemDataSource();
    dataSource = built.dataSource;
    await dataSource.initialize();
    // Schéma PRÉ-migration : retirer ce que synchronize a créé depuis l'entité.
    for (const col of ['opening_float_minor_units', 'counted_cash_minor_units', 'cash_variance_minor_units']) {
      await dataSource.query(`ALTER TABLE "pos_sessions" DROP COLUMN IF EXISTS "${col}"`);
    }
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('up() ajoute les 3 colonnes nullables ; session existante intacte (NULL) ; double-up inoffensif', async () => {
    const id = uuidv4();
    await dataSource.query(
      `INSERT INTO pos_sessions (id, store_id, employee_id, employee_name, employee_role, is_active)
       VALUES ($1, $2, $3, 'Alice', 'cashier', false)`,
      [id, uuidv4(), uuidv4()],
    );

    const mig = new AddPosSessionCashFields1728000000000();
    await mig.up(dataSource.createQueryRunner());
    await mig.up(dataSource.createQueryRunner()); // idempotence

    const [row] = await dataSource.query(
      `SELECT opening_float_minor_units, counted_cash_minor_units, cash_variance_minor_units
         FROM pos_sessions WHERE id = $1`,
      [id],
    );
    expect(row.opening_float_minor_units).toBeNull();
    expect(row.counted_cash_minor_units).toBeNull();
    expect(row.cash_variance_minor_units).toBeNull();

    // accepte des entiers signés (écart négatif possible) et NULL
    await dataSource.query(
      `UPDATE pos_sessions SET opening_float_minor_units = 10000, counted_cash_minor_units = 9950, cash_variance_minor_units = -50 WHERE id = $1`,
      [id],
    );
    const [after] = await dataSource.query(`SELECT cash_variance_minor_units FROM pos_sessions WHERE id = $1`, [id]);
    expect(Number(after.cash_variance_minor_units)).toBe(-50);
  });

  it('down() revert proprement (colonnes disparues), idempotent', async () => {
    const mig = new AddPosSessionCashFields1728000000000();
    await mig.down(dataSource.createQueryRunner());
    await mig.down(dataSource.createQueryRunner());

    const cols: Array<{ column_name: string }> = await dataSource.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'pos_sessions'`,
    );
    const names = cols.map((c) => c.column_name);
    expect(names).not.toContain('opening_float_minor_units');
    expect(names).not.toContain('counted_cash_minor_units');
    expect(names).not.toContain('cash_variance_minor_units');
  });
});
