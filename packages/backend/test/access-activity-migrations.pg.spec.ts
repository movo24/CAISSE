/**
 * Non-régression migrations (accès + journal d'activité) sur un VRAI Postgres.
 * Gated sur TEST_DATABASE_URL — skippé sinon (la suite pg-mem normale n'est pas affectée).
 * ⚠️ Pointer TEST_DATABASE_URL vers une base VIERGE dédiée (le run applique toute la lignée).
 *
 *   TEST_DATABASE_URL=postgresql://user@localhost:5432/caisse_mig_verify \
 *     npx jest --forceExit test/access-activity-migrations.pg.spec.ts
 *
 * Prouve : runMigrations applique la lignée + les 6 nouvelles (schéma snake_case réel) ;
 * revert ×6 déroule proprement les down() ; re-run ré-applique (cycle idempotent).
 */
import * as path from 'path';
import { DataSource } from 'typeorm';
import { loadAllEntities } from './helpers/pgmem';
import { revertToMigration } from './helpers/revert-to-migration';

const TEST_DB = process.env.TEST_DATABASE_URL;
const d = TEST_DB ? describe : describe.skip;

const NEW_MIGRATIONS = [
  'EnrichEmployeeStoreAccess1759000000000',
  'CreateEmployeeApplicationAccess1759000000001',
  'CreateAccessAuditLog1759000000002',
  'CreateUserLoginEvents1759000000003',
  'CreateUserSessions1759000000004',
  'CreateUserViewEvents1759000000005',
];
const NEW_TABLES = ['employee_application_access', 'access_audit_log', 'user_login_events', 'user_sessions', 'user_view_events'];

d('Migrations accès+activité up/down (real Postgres)', () => {
  let ds: DataSource;

  const tableExists = async (t: string): Promise<boolean> =>
    (await ds.query(`SELECT to_regclass('public.${t}') IS NOT NULL AS e`))[0].e === true;
  const columns = async (t: string): Promise<string[]> =>
    (await ds.query('SELECT column_name FROM information_schema.columns WHERE table_name=$1', [t])).map((r: any) => r.column_name);
  const appliedNames = async (): Promise<string[]> =>
    (await ds.query('SELECT name FROM migrations')).map((r: any) => r.name);

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

  it('runMigrations applique la lignée + les 6 nouvelles ; schéma snake_case réel', async () => {
    await ds.runMigrations({ transaction: 'each' });
    const applied = await appliedNames();
    for (const n of NEW_MIGRATIONS) expect(applied).toContain(n);
    for (const t of NEW_TABLES) expect(await tableExists(t)).toBe(true);
    const esa = await columns('employee_store_access');
    expect(esa).toEqual(
      expect.arrayContaining(['employee_id', 'store_id', 'access_role', 'can_view_financials', 'valid_until', 'revoked_at', 'updated_at']),
    );
  }, 120000);

  it('revert par NOM vers la 1re migration accès (jamais par comptage) — déroule les down()', async () => {
    // Cible PAR NOM : « revert ×6 » supposait que les 6 migrations accès étaient les
    // dernières de la lignée — faux dès que 1760-1766 (catalogue) et 1767 (fiscal)
    // sont empilées au-dessus ; tout ce qui est au-dessus est déroulé aussi.
    await revertToMigration(ds, 'EnrichEmployeeStoreAccess1759000000000');
    for (const t of NEW_TABLES) expect(await tableExists(t)).toBe(false);
    expect(await columns('employee_store_access')).not.toContain('can_view_financials');
    const applied = await appliedNames();
    for (const n of NEW_MIGRATIONS) expect(applied).not.toContain(n);
  }, 120000);

  it('re-run ré-applique proprement (cycle idempotent)', async () => {
    await ds.runMigrations({ transaction: 'each' });
    for (const t of NEW_TABLES) expect(await tableExists(t)).toBe(true);
    const esa = await columns('employee_store_access');
    expect(esa).toContain('can_view_financials');
  }, 120000);
});
