/**
 * Non-régression migration F0 (liaison vente sur stock_movements) sur un VRAI Postgres.
 * Gated sur TEST_DATABASE_URL — skippé sinon (la suite pg-mem normale n'est pas affectée).
 * ⚠️ Pointer TEST_DATABASE_URL vers une base VIERGE dédiée (le run applique toute la lignée).
 *
 *   TEST_DATABASE_URL=postgresql://user@localhost:5432/caisse_mig_verify \
 *     npx jest --forceExit test/stock-movement-linkage-migration.pg.spec.ts
 *
 * Prouve, pour le bloc F0 (PRODUCTS_FISCAL_STOCK_SYNTHESIS.md) :
 *  - up : les 4 colonnes de liaison + les 3 index (dont l'unique partielle d'idempotence) existent ;
 *  - down : les colonnes ET les index sont retirés proprement ;
 *  - re-run : cycle idempotent ;
 *  - F0 est PUREMENT additif : aucune colonne existante de stock_movements n'est perdue,
 *    et la surface fiscale (sales / fiscal_journal / credit_notes / audit_entries) est intacte.
 */
import * as path from 'path';
import { DataSource } from 'typeorm';
import { loadAllEntities } from './helpers/pgmem';

const TEST_DB = process.env.TEST_DATABASE_URL;
const d = TEST_DB ? describe : describe.skip;

const MIGRATION = 'AddStockMovementSaleLinkage1767000000000';
const NEW_COLUMNS = ['store_id', 'sale_id', 'sale_line_item_id', 'occurred_at'];
const NEW_INDEXES = [
  'idx_stock_movements_sale',
  'idx_stock_movements_store_created',
  'uq_stock_movements_sale_line_product_type',
];
// Colonnes préexistantes qui ne doivent JAMAIS disparaître (additif strict).
const LEGACY_COLUMNS = ['id', 'product_id', 'movement_type', 'from_location_id', 'to_location_id', 'quantity', 'employee_id', 'created_at'];
// Surface fiscale — non touchée par F0.
const FISCAL_TABLES = ['sales', 'fiscal_journal', 'credit_notes', 'audit_entries', 'sale_component_movements'];

d('Migration F0 stock_movements liaison vente up/down (real Postgres)', () => {
  let ds: DataSource;

  const columns = async (t: string): Promise<string[]> =>
    (await ds.query('SELECT column_name FROM information_schema.columns WHERE table_name=$1', [t])).map((r: any) => r.column_name);
  const indexes = async (t: string): Promise<Array<{ name: string; def: string }>> =>
    (await ds.query('SELECT indexname AS name, indexdef AS def FROM pg_indexes WHERE tablename=$1', [t])).map((r: any) => ({ name: r.name, def: r.def }));
  const appliedNames = async (): Promise<string[]> =>
    (await ds.query('SELECT name FROM migrations')).map((r: any) => r.name);
  const tableExists = async (t: string): Promise<boolean> =>
    (await ds.query(`SELECT to_regclass('public.${t}') IS NOT NULL AS e`))[0].e === true;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      url: TEST_DB,
      entities: loadAllEntities() as any,
      migrations: [path.join(__dirname, '../src/database/migrations/*.ts')],
      synchronize: false,
      migrationsRun: false,
    });
    await ds.initialize();
    await ds.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  }, 120000);

  afterAll(async () => {
    await ds?.destroy();
  });

  it('up : colonnes de liaison + index (dont unique partielle), colonnes legacy préservées', async () => {
    await ds.runMigrations({ transaction: 'each' });
    expect(await appliedNames()).toContain(MIGRATION);

    const cols = await columns('stock_movements');
    for (const c of NEW_COLUMNS) expect(cols).toContain(c);
    for (const c of LEGACY_COLUMNS) expect(cols).toContain(c); // additif strict

    const idx = await indexes('stock_movements');
    const names = idx.map((i) => i.name);
    for (const n of NEW_INDEXES) expect(names).toContain(n);

    // L'index d'idempotence est UNIQUE et PARTIEL (WHERE sale_id IS NOT NULL).
    const uq = idx.find((i) => i.name === 'uq_stock_movements_sale_line_product_type')!;
    expect(uq.def).toMatch(/UNIQUE INDEX/i);
    expect(uq.def).toMatch(/WHERE .*sale_id/i);

    // Surface fiscale intacte (les tables existent, F0 ne les touche pas).
    for (const t of FISCAL_TABLES) expect(await tableExists(t)).toBe(true);
  }, 120000);

  it('down : colonnes ET index retirés, table conservée', async () => {
    await ds.undoLastMigration({ transaction: 'each' });
    const cols = await columns('stock_movements');
    for (const c of NEW_COLUMNS) expect(cols).not.toContain(c);
    for (const c of LEGACY_COLUMNS) expect(cols).toContain(c); // le reste survit
    const names = (await indexes('stock_movements')).map((i) => i.name);
    for (const n of NEW_INDEXES) expect(names).not.toContain(n);
    expect(await appliedNames()).not.toContain(MIGRATION);
    expect(await tableExists('stock_movements')).toBe(true);
  }, 120000);

  it('re-run : cycle idempotent', async () => {
    await ds.runMigrations({ transaction: 'each' });
    const cols = await columns('stock_movements');
    for (const c of NEW_COLUMNS) expect(cols).toContain(c);
    expect(await appliedNames()).toContain(MIGRATION);
  }, 120000);
});
