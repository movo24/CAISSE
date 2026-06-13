import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { newDb, DataType, IMemoryDb } from 'pg-mem';
import { v4 as uuidv4 } from 'uuid';

const ENT_DIR = path.join(__dirname, '../../src/database/entities');

/** Load every TypeORM entity class (synchronize needs the full related graph). */
export function loadAllEntities(): any[] {
  return fs
    .readdirSync(ENT_DIR)
    .filter((f) => f.endsWith('.entity.ts'))
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    .flatMap((f) => Object.values(require(path.join(ENT_DIR, f))))
    .filter((v) => typeof v === 'function');
}

/**
 * Create an in-memory Postgres (pg-mem) TypeORM DataSource with the shims TypeORM
 * needs (version/current_database) and uuid generation. Schema via synchronize.
 */
export function createPgMemDataSource(): { db: IMemoryDb; dataSource: DataSource } {
  const db = newDb();
  // The analytics-projection read model lives in a dedicated `analytics` schema
  // (INV-2). The entities declare schema:'analytics'; synchronize needs the schema
  // to pre-exist (TypeORM does not create schemas). Additive — public-schema tests
  // are unaffected.
  (db as any).createSchema('analytics');
  // The notify schema (étage 4: device tokens / preferences / deliveries) — same
  // pre-creation requirement (TypeORM synchronize does not create schemas).
  (db as any).createSchema('notify');
  db.public.registerFunction({ name: 'version', returns: DataType.text, implementation: () => 'PostgreSQL 14.0 (pg-mem)' });
  db.public.registerFunction({ name: 'current_database', returns: DataType.text, implementation: () => 'test' });
  // impure: true → pg-mem ne met PAS le résultat en cache (chaque appel génère
  // un UUID frais). Sans ça, un DEFAULT uuid_generate_v4() réutilise la même
  // valeur et provoque une collision de clé primaire au 2e INSERT.
  db.public.registerFunction({ name: 'uuid_generate_v4', returns: DataType.uuid, impure: true, implementation: () => uuidv4() });
  db.registerExtension('uuid-ossp', (schema) =>
    schema.registerFunction({ name: 'uuid_generate_v4', returns: DataType.uuid, impure: true, implementation: () => uuidv4() }),
  );
  // Functions pg-mem doesn't ship that our SQL uses.
  db.public.registerFunction({
    name: 'date', args: [DataType.timestamp], returns: DataType.text,
    implementation: (d: Date) => (d ? new Date(d).toISOString().slice(0, 10) : null),
  });
  for (const t of [DataType.integer, DataType.bigint, DataType.float] as const) {
    db.public.registerFunction({ name: 'greatest', args: [t, t], returns: t, implementation: (a: any, b: any) => Math.max(Number(a), Number(b)) });
    db.public.registerFunction({ name: 'least', args: [t, t], returns: t, implementation: (a: any, b: any) => Math.min(Number(a), Number(b)) });
  }

  const dataSource: DataSource = db.adapters.createTypeormDataSource({
    type: 'postgres',
    entities: loadAllEntities() as any,
    synchronize: true,
  });

  return { db, dataSource };
}
