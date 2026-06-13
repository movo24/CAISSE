/**
 * Governance chantier, commit 2 — role control-plane (owner-only grant/revoke of
 * employee_store_access), each change atomic with a chained audit entry on the
 * STORE's chain. Decisive: the control plane actually DRIVES INV-5 — a grant
 * makes the scope resolver include the store; a revoke drops it.
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { EmployeeEntity } from '../src/database/entities/employee.entity';
import { StoreEntity } from '../src/database/entities/store.entity';
import { EmployeeStoreAccessEntity } from '../src/database/entities/employee-store-access.entity';
import { AuditEntryEntity } from '../src/database/entities/audit-entry.entity';
import { AuditService } from '../src/modules/audit/audit.service';
import { EmployeeStoreAccessService } from '../src/modules/employees/employee-store-access.service';
import { StoreScopeResolverService } from '../src/modules/analytics-projection/store-scope-resolver.service';

describe('Commit 2 — store-access control plane (owner-only, audited, drives INV-5)', () => {
  let ds: DataSource;
  let svc: EmployeeStoreAccessService;
  let audit: AuditService;
  let resolver: StoreScopeResolverService;
  const MANAGER = uuidv4();
  const ADMIN = uuidv4(); // the actor performing grant/revoke
  const HOME = uuidv4(); // manager's home store
  const S2 = uuidv4(); // the store we grant/revoke

  const auditRows = (storeId: string) =>
    ds.getRepository(AuditEntryEntity).find({ where: { storeId }, order: { timestamp: 'ASC' } });
  const scopeOf = () =>
    resolver.resolveAccessibleStoreIds({ employeeId: MANAGER, storeId: HOME, role: 'manager' });

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    await ds.getRepository(StoreEntity).save([
      { id: HOME, name: 'Home', isActive: true, currencyCode: 'EUR' },
      { id: S2, name: 'Second', isActive: true, currencyCode: 'EUR' },
    ] as any);
    await ds.getRepository(EmployeeEntity).save({
      id: MANAGER, storeId: HOME, firstName: 'M', lastName: 'gr', email: `${MANAGER}@x.fr`,
      pinHash: 'h', qrCode: MANAGER, role: 'manager',
    } as any);
    audit = new AuditService(ds.getRepository(AuditEntryEntity), ds);
    svc = new EmployeeStoreAccessService(
      ds.getRepository(EmployeeStoreAccessEntity),
      ds.getRepository(EmployeeEntity),
      ds.getRepository(StoreEntity),
      audit,
    );
    resolver = new StoreScopeResolverService(
      ds.getRepository(StoreEntity),
      ds.getRepository(EmployeeStoreAccessEntity),
    );
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('before any grant, the manager sees only the home store', async () => {
    expect((await scopeOf()).sort()).toEqual([HOME].sort());
  });

  it('DECISIVE — grant writes the row, an attributable audit entry on the store, and the resolver now includes S2', async () => {
    await svc.grant(MANAGER, S2, ADMIN);

    expect(await ds.getRepository(EmployeeStoreAccessEntity).count({ where: { employeeId: MANAGER, storeId: S2 } })).toBe(1);
    const rows = await auditRows(S2);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      storeId: S2,
      employeeId: ADMIN, // the actor, not the subject
      action: 'store_access_granted',
      entityType: 'employee_store_access',
      entityId: MANAGER, // the subject whose access changed
    });
    expect((rows[0].details as any).grantedEmployeeId).toBe(MANAGER);
    // the control plane DRIVES INV-5:
    expect((await scopeOf()).sort()).toEqual([HOME, S2].sort());
  });

  it('grant is idempotent — a re-grant keeps exactly one access row', async () => {
    await svc.grant(MANAGER, S2, ADMIN);
    expect(await ds.getRepository(EmployeeStoreAccessEntity).count({ where: { employeeId: MANAGER, storeId: S2 } })).toBe(1);
  });

  it('DECISIVE — revoke removes the row, appends a chained audit entry, and the resolver drops S2', async () => {
    await svc.revoke(MANAGER, S2, ADMIN);
    expect(await ds.getRepository(EmployeeStoreAccessEntity).count({ where: { employeeId: MANAGER, storeId: S2 } })).toBe(0);
    const rows = await auditRows(S2);
    expect(rows[rows.length - 1]).toMatchObject({ action: 'store_access_revoked', employeeId: ADMIN, entityId: MANAGER });
    expect(rows[rows.length - 1].previousHash).toBe(rows[rows.length - 2].currentHash); // chained
    expect((await audit.verifyChain(S2)).valid).toBe(true);
    expect((await scopeOf()).sort()).toEqual([HOME].sort());
  });

  it('ADVERSE — unknown employee or store → NotFound, NOTHING written or audited', async () => {
    const ghost = uuidv4();
    const before = (await auditRows(S2)).length;
    await expect(svc.grant(ghost, S2, ADMIN)).rejects.toThrow(/introuvable/);
    await expect(svc.grant(MANAGER, uuidv4(), ADMIN)).rejects.toThrow(/introuvable/);
    expect((await auditRows(S2)).length).toBe(before); // no audit noise from rejected attempts
  });
});
