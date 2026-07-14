/**
 * Lot 1 — `employee_store_access` réparée + enrichie.
 *
 * L'ancienne entité était désynchronisée de sa migration (colonnes camelCase alors que
 * la table réelle est snake_case) et jamais enregistrée dans TypeORM. Ces tests prouvent :
 *  - le mapping snake_case exact dont dépend le sous-SELECT brut de `auth.service.ts` ;
 *  - les défauts de permissions granulaires ;
 *  - la fenêtre de validité + la révocation soft-delete (ligne conservée) ;
 *  - l'unicité (une affectation par employé/magasin).
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { EmployeeStoreAccessEntity } from '../src/database/entities/employee-store-access.entity';

describe('Lot 1 — employee_store_access enrichie', () => {
  let ds: DataSource;
  let repo: ReturnType<DataSource['getRepository']>;

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    repo = ds.getRepository(EmployeeStoreAccessEntity);
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('mappe les colonnes snake_case exactes dont dépend le sous-SELECT auth', async () => {
    const employeeId = uuidv4();
    const storeId = uuidv4();
    await repo.save(
      repo.create({ employeeId, storeId, accessRole: 'STORE_MANAGER', canViewFinancials: true }),
    );
    // La requête brute EXACTE de auth.service.ts doit réussir contre le schéma synchronisé.
    const rows = await ds.query(
      'SELECT employee_id FROM employee_store_access WHERE store_id = $1',
      [storeId],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].employee_id).toBe(employeeId);
  });

  it('applique les défauts de permissions granulaires', async () => {
    const saved = await repo.save(repo.create({ employeeId: uuidv4(), storeId: uuidv4() }));
    const row: any = await repo.findOne({ where: { id: saved.id } });
    expect(row.canViewDashboard).toBe(true);
    expect(row.canViewAlerts).toBe(true);
    expect(row.canViewFinancials).toBe(false);
    expect(row.canViewEmployees).toBe(false);
    expect(row.canCompare).toBe(false);
    expect(row.revokedAt).toBeNull();
    expect(row.grantedAt).toBeTruthy();
  });

  it('supporte fenêtre de validité + révocation soft-delete (ligne conservée)', async () => {
    const saved = await repo.save(
      repo.create({
        employeeId: uuidv4(),
        storeId: uuidv4(),
        validFrom: new Date('2026-07-01T00:00:00Z'),
        validUntil: new Date('2026-08-01T00:00:00Z'),
      }),
    );
    await repo.update(saved.id, { revokedAt: new Date(), revokedBy: uuidv4() });
    const row: any = await repo.findOne({ where: { id: saved.id } });
    expect(row.revokedAt).toBeTruthy(); // révoqué
    expect(row.validUntil).toBeTruthy(); // fenêtre conservée
    expect(await repo.count({ where: { id: saved.id } })).toBe(1); // pas supprimée
  });

  it('impose une seule affectation par (employé, magasin)', async () => {
    const employeeId = uuidv4();
    const storeId = uuidv4();
    await repo.save(repo.create({ employeeId, storeId }));
    await expect(repo.save(repo.create({ employeeId, storeId }))).rejects.toThrow();
  });
});
