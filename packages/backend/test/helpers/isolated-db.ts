/**
 * Isolation des specs PG sur une base jetable DÉDIÉE.
 *
 * Pourquoi : en CI (.github/workflows/ci.yml, étape « Backend PG specs »),
 * tous les *.pg.spec.ts partagent UNE base (caisse_test) en série. Les specs
 * `synchronize: true` SUPPRIMENT les index inconnus des entités — dont ceux
 * créés par les migrations (ex. idx_stock_movements_sale de 1767). Un spec de
 * migration qui déroule la lignée sur la base partagée rend donc la suite
 * sensible à l'ordre des fichiers jest (tri par taille) : l'ajout d'un fichier
 * classé avant lui la fait échouer.
 *
 * Règle : TOUT spec de migration (runMigrations / revert sur la lignée) doit
 * utiliser ce helper — TEST_DATABASE_URL ne sert que de connexion bootstrap
 * pour (re)créer sa PROPRE base, détruite en sortie. Les specs
 * `synchronize: true` peuvent rester sur la base partagée.
 *
 * `WITH (FORCE)` requiert PostgreSQL 13+ (CI et docker local : pg16).
 */
import { DataSource } from 'typeorm';

/** Nom de base strictement contrôlé — interpolé dans du SQL non paramétrable. */
const assertSafeDbName = (dbName: string): void => {
  if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) {
    throw new Error(`Nom de base jetable invalide: ${dbName}`);
  }
};

/** URL de connexion vers la base jetable, dérivée de l'URL bootstrap. */
export const isolatedDbUrl = (bootstrapUrl: string, dbName: string): string => {
  assertSafeDbName(dbName);
  const u = new URL(bootstrapUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
};

const adminQuery = async (bootstrapUrl: string, sql: string): Promise<void> => {
  const admin = new DataSource({ type: 'postgres', url: bootstrapUrl });
  await admin.initialize();
  try {
    await admin.query(sql);
  } finally {
    await admin.destroy();
  }
};

/** (Re)crée la base jetable — droppe d'abord un éventuel reliquat d'un run tué. */
export const createIsolatedDb = async (
  bootstrapUrl: string,
  dbName: string,
): Promise<void> => {
  assertSafeDbName(dbName);
  await adminQuery(bootstrapUrl, `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await adminQuery(bootstrapUrl, `CREATE DATABASE ${dbName}`);
};

/** Détruit la base jetable en sortie de spec. */
export const dropIsolatedDb = async (
  bootstrapUrl: string,
  dbName: string,
): Promise<void> => {
  assertSafeDbName(dbName);
  await adminQuery(bootstrapUrl, `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
};
