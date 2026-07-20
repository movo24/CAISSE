/**
 * Non-régression alignement entité/table `units` sur un VRAI Postgres.
 * Gated sur TEST_DATABASE_URL — skippé sinon (la suite pg-mem normale n'est pas affectée).
 *
 * ISOLATION : ce spec ne travaille PAS dans la base de TEST_DATABASE_URL — il
 * s'en sert comme connexion bootstrap pour (re)créer sa PROPRE base jetable
 * (`caisse_units_alignment_spec`) et la détruit en sortie. Raison : en CI les
 * specs PG partagent une seule base en série, et les specs `synchronize: true`
 * SUPPRIMENT les index créés par les migrations (TypeORM synchronize drop les
 * index inconnus des entités) — un spec de migration qui déroule la lignée sur
 * la base partagée rend donc la suite sensible à l'ordre des fichiers
 * (constaté : ajout de ce fichier → stock-movement-linkage-migration rouge).
 *
 *   TEST_DATABASE_URL=postgresql://user@localhost:5432/caisse_mig_verify \
 *     npx jest --forceExit test/units-entity-alignment.pg.spec.ts
 *
 * Bug d'origine : UnitEntity déclarait `type`/`country`/`currency_code`/`notes`
 * alors que la table `units` réelle (InitialSchema 1700000000000) ne les avait
 * jamais reçues — le CREATE TABLE IF NOT EXISTS de MultiEntityHierarchy
 * 1710600000000 a no-opé. Toute jointure de la relation `unit`
 * (ex. GET /api/stores/accessible) échouait :
 * `column StoreEntity__StoreEntity_unit.type does not exist`.
 *
 * Prouve :
 *  - up (1772) : les 4 colonnes opérationnelles existent, les colonnes
 *    d'origine (dont code/description) sont préservées — additif strict ;
 *  - lecture : charger un store AVEC la relation `unit` via TypeORM passe
 *    (reproduction directe du 500 d'origine) ;
 *  - écriture : save d'une unit avec type/country/currencyCode/notes persiste ;
 *  - down : seules les 4 colonnes ajoutées disparaissent, la table survit ;
 *  - re-run : cycle idempotent.
 */
import * as path from 'path';
import { DataSource } from 'typeorm';
import { loadAllEntities } from './helpers/pgmem';
import { revertToMigration } from './helpers/revert-to-migration';
import { UnitEntity } from '../src/database/entities/unit.entity';
import { StoreEntity } from '../src/database/entities/store.entity';

const TEST_DB = process.env.TEST_DATABASE_URL;
const d = TEST_DB ? describe : describe.skip;

/** Base jetable dédiée à ce spec (créée depuis TEST_DATABASE_URL, détruite en sortie). */
const ISOLATED_DB = 'caisse_units_alignment_spec';
const isolatedUrl = (): string => {
  const u = new URL(TEST_DB as string);
  u.pathname = `/${ISOLATED_DB}`;
  return u.toString();
};

const MIGRATION = 'AddUnitOperationalColumns1772000000000';
const NEW_COLUMNS = ['type', 'country', 'currency_code', 'notes'];
// Colonnes créées par InitialSchema — ne doivent JAMAIS disparaître (additif strict).
const LEGACY_COLUMNS = [
  'id',
  'organization_id',
  'name',
  'code',
  'description',
  'is_active',
  'created_at',
  'updated_at',
];

d('Alignement entité/table units + migration 1772 up/down (real Postgres)', () => {
  let ds: DataSource;

  const columns = async (t: string): Promise<string[]> =>
    (
      await ds.query(
        'SELECT column_name FROM information_schema.columns WHERE table_name=$1',
        [t],
      )
    ).map((r: any) => r.column_name);
  const appliedNames = async (): Promise<string[]> =>
    (await ds.query('SELECT name FROM migrations')).map((r: any) => r.name);
  const tableExists = async (t: string): Promise<boolean> =>
    (await ds.query(`SELECT to_regclass('public.${t}') IS NOT NULL AS e`))[0]
      .e === true;

  const adminQuery = async (sql: string): Promise<void> => {
    const admin = new DataSource({ type: 'postgres', url: TEST_DB });
    await admin.initialize();
    try {
      await admin.query(sql);
    } finally {
      await admin.destroy();
    }
  };

  beforeAll(async () => {
    await adminQuery(`DROP DATABASE IF EXISTS ${ISOLATED_DB} WITH (FORCE)`);
    await adminQuery(`CREATE DATABASE ${ISOLATED_DB}`);
    ds = new DataSource({
      type: 'postgres',
      url: isolatedUrl(),
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
    await adminQuery(`DROP DATABASE IF EXISTS ${ISOLATED_DB} WITH (FORCE)`);
  });

  it('up : les 4 colonnes opérationnelles existent, les colonnes InitialSchema préservées', async () => {
    await ds.runMigrations({ transaction: 'each' });
    expect(await appliedNames()).toContain(MIGRATION);

    const cols = await columns('units');
    for (const c of NEW_COLUMNS) expect(cols).toContain(c);
    for (const c of LEGACY_COLUMNS) expect(cols).toContain(c); // additif strict
  }, 120000);

  it('lecture : store chargé AVEC la relation unit (reproduction du 500 stores/accessible)', async () => {
    const [org] = await ds.query(
      `INSERT INTO organizations (name) VALUES ('Org Test Unit Alignment') RETURNING id`,
    );
    const [unit] = await ds.query(
      `INSERT INTO units (organization_id, name, code, description)
       VALUES ($1, 'Unit Lecture', 'UL-01', 'unité de test lecture') RETURNING id`,
      [org.id],
    );
    const [store] = await ds.query(
      `INSERT INTO stores (name, organization_id, unit_id)
       VALUES ('Store Test Unit Alignment', $1, $2) RETURNING id`,
      [org.id, unit.id],
    );

    // C'est exactement la requête qui explosait : jointure de la relation unit.
    const loaded = await ds.getRepository(StoreEntity).findOne({
      where: { id: store.id },
      relations: ['unit'],
    });
    expect(loaded).not.toBeNull();
    expect(loaded!.unit).toBeDefined();
    expect(loaded!.unit.id).toBe(unit.id);
    // Défauts appliqués par la migration 1772 sur une ligne insérée sans ces champs.
    expect(loaded!.unit.type).toBe('retail');
    expect(loaded!.unit.country).toBe('FR');
    expect(loaded!.unit.currencyCode).toBe('EUR');
    // Colonnes InitialSchema désormais mappées par l'entité.
    expect(loaded!.unit.code).toBe('UL-01');
    expect(loaded!.unit.description).toBe('unité de test lecture');
  }, 120000);

  it('écriture : save UnitEntity avec type/country/currencyCode/notes persiste', async () => {
    const [org] = await ds.query(
      `INSERT INTO organizations (name) VALUES ('Org Test Unit Write') RETURNING id`,
    );
    const repo = ds.getRepository(UnitEntity);
    const saved = await repo.save(
      repo.create({
        organizationId: org.id,
        name: 'Unit Écriture',
        type: 'warehouse',
        country: 'BE',
        currencyCode: 'EUR',
        notes: 'notes de test',
      }),
    );

    const [row] = await ds.query(
      `SELECT type, country, currency_code, notes FROM units WHERE id = $1`,
      [saved.id],
    );
    expect(row.type).toBe('warehouse');
    expect(row.country).toBe('BE');
    expect(row.currency_code).toBe('EUR');
    expect(row.notes).toBe('notes de test');
  }, 120000);

  it('down : seules les 4 colonnes ajoutées disparaissent, la table et ses données survivent', async () => {
    // Cible PAR NOM, jamais par comptage (helper revertToMigration).
    await revertToMigration(ds, MIGRATION);
    const cols = await columns('units');
    for (const c of NEW_COLUMNS) expect(cols).not.toContain(c);
    for (const c of LEGACY_COLUMNS) expect(cols).toContain(c);
    expect(await appliedNames()).not.toContain(MIGRATION);
    expect(await tableExists('units')).toBe(true);
    // Les lignes insérées plus haut survivent au down (additif ⇄ réversible sans perte).
    const [{ n }] = await ds.query(`SELECT count(*)::int AS n FROM units`);
    expect(n).toBeGreaterThanOrEqual(2);
  }, 120000);

  it('re-run : cycle idempotent', async () => {
    await ds.runMigrations({ transaction: 'each' });
    const cols = await columns('units');
    for (const c of NEW_COLUMNS) expect(cols).toContain(c);
    expect(await appliedNames()).toContain(MIGRATION);
  }, 120000);
});
