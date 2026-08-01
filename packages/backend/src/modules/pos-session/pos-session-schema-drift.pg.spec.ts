import { DataSource } from 'typeorm';
import { EnsurePosSessionColumns1776000000000 } from '../../database/migrations/1776000000000-EnsurePosSessionColumns';

/**
 * P0 — PREUVE de la cause du HTTP 500 sur « Rouvrir la session » et correctif.
 *
 * `PosSessionService.openSession` fait `repo.findOne(...)` puis `repo.save(...)`
 * sur `pos_sessions` : TypeORM SELECT/INSERT TOUTES les colonnes de l'entité,
 * dont `timewin_session_token`. Cette colonne n'existe que dans le CREATE TABLE
 * initial (aucun ALTER) : si la table prod vient d'un `synchronize` antérieur,
 * elle manque → PostgreSQL 42703 → 500. Reproduit ici sur un VRAI Postgres, puis
 * on applique la migration 1776 et l'insertion réussit.
 *
 * CI-safety (règle D23) : tout se passe dans un SCHÉMA temporaire dédié
 * (search_path), jamais sur `public.pos_sessions`. Le schéma est détruit à la fin.
 * Gaté par TEST_DATABASE_URL (skip sans base réelle).
 */
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

// Liste EXACTE des colonnes SELECT par l'entité (ordre de déclaration), pour
// reproduire la requête réelle sans dépendre du contexte NestJS.
const ENTITY_COLUMNS = [
  'id', 'store_id', 'employee_id', 'terminal_id', 'employee_name', 'employee_role',
  'max_discount', 'permissions', 'timewin_session_token', 'is_active',
  'opening_cash_minor_units', 'opening_cash_set_at', 'opening_cash_corrected_by',
  'opening_cash_corrected_at', 'cash_sales_minor_units', 'cash_refunds_minor_units',
  'expected_cash_minor_units', 'counted_cash_minor_units', 'cash_difference_minor_units',
  'cash_counted_at', 'cash_count_skipped_reason', 'cash_count_skipped_at',
  'opened_at', 'closed_at', 'offline_mode',
];

d('pos_sessions — dérive de schéma = cause du 500 openSession (vrai Postgres)', () => {
  let ds: DataSource;
  const schema = `drift_repro_${Date.now().toString(36)}`;

  beforeAll(async () => {
    ds = new DataSource({ type: 'postgres', url });
    await ds.initialize();
    await ds.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await ds.query(`SET search_path TO "${schema}"`);
    // pos_sessions COMPLET *sauf* timewin_session_token (dérive prod simulée).
    await ds.query(`CREATE TABLE "${schema}".pos_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      store_id VARCHAR NOT NULL, employee_id VARCHAR NOT NULL,
      terminal_id VARCHAR, employee_name VARCHAR NOT NULL, employee_role VARCHAR NOT NULL,
      max_discount DECIMAL DEFAULT 0, permissions JSONB DEFAULT '{}',
      is_active BOOLEAN DEFAULT true,
      opening_cash_minor_units INTEGER, opening_cash_set_at TIMESTAMP,
      opening_cash_corrected_by UUID, opening_cash_corrected_at TIMESTAMP,
      cash_sales_minor_units INTEGER, cash_refunds_minor_units INTEGER,
      expected_cash_minor_units INTEGER, counted_cash_minor_units INTEGER,
      cash_difference_minor_units INTEGER, cash_counted_at TIMESTAMP,
      cash_count_skipped_reason VARCHAR, cash_count_skipped_at TIMESTAMP,
      opened_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, closed_at TIMESTAMPTZ,
      offline_mode BOOLEAN DEFAULT false
    )`);
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await ds.destroy();
    }
  });

  const insertLikeOpenSession = () =>
    ds.query(
      `INSERT INTO "${schema}".pos_sessions ` +
        `(store_id, employee_id, terminal_id, employee_name, employee_role, max_discount, permissions, is_active, offline_mode, opening_cash_minor_units) ` +
        `VALUES ('s1','e1','TERMINAL 01','K','cashier',0,'{}'::jsonb,true,false,18750)`,
    );

  const selectLikeFindOne = () =>
    ds.query(
      `SELECT ${ENTITY_COLUMNS.map((c) => `"${c}"`).join(', ')} ` +
        `FROM "${schema}".pos_sessions WHERE store_id='s1' AND terminal_id='TERMINAL 01' AND is_active=true`,
    );

  it('AVANT correctif : le SELECT/INSERT du chemin openSession échoue en 42703 (= 500)', async () => {
    await ds.query(`SET search_path TO "${schema}"`);
    await expect(selectLikeFindOne()).rejects.toMatchObject({ code: '42703' });
    await expect(insertLikeOpenSession()).resolves.toBeDefined(); // l'INSERT sans la colonne passe...
    // ...mais TypeORM ajoute la colonne au INSERT ; c'est le SELECT complet qui plante.
    await ds.query(`DELETE FROM "${schema}".pos_sessions`);
  });

  it('APRÈS migration 1776 : la colonne existe, le SELECT complet passe, la session s\'ouvre', async () => {
    await ds.query(`SET search_path TO "${schema}"`);
    const qr = ds.createQueryRunner();
    await qr.query(`SET search_path TO "${schema}"`);
    await new EnsurePosSessionColumns1776000000000().up(qr); // applique le VRAI correctif
    await qr.release();

    const cols: Array<{ column_name: string }> = await ds.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='${schema}' AND table_name='pos_sessions' AND column_name='timewin_session_token'`,
    );
    expect(cols.length).toBe(1); // colonne posée

    await expect(selectLikeFindOne()).resolves.toBeDefined(); // plus de 42703
    await expect(insertLikeOpenSession()).resolves.toBeDefined();
  });
});
