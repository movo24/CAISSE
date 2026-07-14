/**
 * Lot 5 — AccessAdminService : mutations d'accès tracées dans access_audit_log.
 *
 * Prouve : grant application + store → accès effectif OK + audit ACCESS_GRANTED/STORE_ADDED ;
 * changement de rôle → ROLE_CHANGED ; révocation → STORE_REMOVED + accès coupé (§18-6) ;
 * suspension → ACCOUNT_SUSPENDED + blocage ; chaîne d'audit toujours valide (§19 traçabilité).
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { EmployeeEntity } from '../src/database/entities/employee.entity';
import { EmployeeApplicationAccessEntity } from '../src/database/entities/employee-application-access.entity';
import { EmployeeStoreAccessEntity } from '../src/database/entities/employee-store-access.entity';
import { AccessAuditLogEntity } from '../src/database/entities/access-audit-log.entity';
import { AccessService } from '../src/modules/pilotage-access/access.service';
import { AccessAuditService } from '../src/modules/pilotage-access/access-audit.service';
import { AccessAdminService } from '../src/modules/pilotage-access/access-admin.service';

describe('Lot 5 — AccessAdminService', () => {
  let ds: DataSource;
  let admin: AccessAdminService;
  let access: AccessService;
  let audit: AccessAuditService;
  const ACTOR = { actorEmployeeId: uuidv4(), ipAddress: '10.0.0.1' };
  const CERGY = uuidv4();

  const events = async () =>
    (await ds.getRepository(AccessAuditLogEntity).find({ order: { occurredAt: 'ASC' } })).map((r) => r.eventType);

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    const appRepo = ds.getRepository(EmployeeApplicationAccessEntity);
    const storeRepo = ds.getRepository(EmployeeStoreAccessEntity);
    audit = new AccessAuditService(ds.getRepository(AccessAuditLogEntity) as any);
    admin = new AccessAdminService(appRepo as any, storeRepo as any, audit);
    access = new AccessService(appRepo as any, storeRepo as any, ds.getRepository(EmployeeEntity) as any);
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('grant application + store → accès effectif + audit ; chaîne valide', async () => {
    const emp = uuidv4();
    await admin.grantApplicationAccess(emp, { applicationRole: 'STORE_MANAGER' }, ACTOR);
    await admin.grantStoreAccess(emp, CERGY, { canViewFinancials: true }, ACTOR);

    const eff = await access.resolveEffectiveAccess({ employeeId: emp, storeId: CERGY, permission: 'can_view_financials', accountActive: true });
    expect(eff.allowed).toBe(true);
    expect(await events()).toEqual(['ACCESS_GRANTED', 'STORE_ADDED']);
    expect((await audit.verifyChain()).valid).toBe(true);
  });

  it('changement de rôle applicatif → ROLE_CHANGED', async () => {
    const emp = uuidv4();
    await admin.grantApplicationAccess(emp, { applicationRole: 'STORE_MANAGER' }, ACTOR);
    await admin.grantApplicationAccess(emp, { applicationRole: 'REGIONAL_MANAGER' }, ACTOR);
    const evs = await events();
    expect(evs).toContain('ROLE_CHANGED');
  });

  it('§18-6 — révocation coupe l’accès + trace STORE_REMOVED', async () => {
    const emp = uuidv4();
    await admin.grantApplicationAccess(emp, { applicationRole: 'STORE_MANAGER' }, ACTOR);
    await admin.grantStoreAccess(emp, CERGY, {}, ACTOR);
    expect((await access.resolveEffectiveAccess({ employeeId: emp, storeId: CERGY, accountActive: true })).allowed).toBe(true);

    await admin.revokeStoreAccess(emp, CERGY, 'fin de mission', ACTOR);
    const after = await access.resolveEffectiveAccess({ employeeId: emp, storeId: CERGY, accountActive: true });
    expect(after.allowed).toBe(false);
    expect(after.reason).toBe('STORE_NOT_IN_SCOPE');
    expect(await events()).toContain('STORE_REMOVED');
  });

  it('suspension → ACCOUNT_SUSPENDED + blocage ; réactivation rétablit', async () => {
    const emp = uuidv4();
    await admin.grantApplicationAccess(emp, { applicationRole: 'STORE_MANAGER' }, ACTOR);
    await admin.grantStoreAccess(emp, CERGY, {}, ACTOR);

    await admin.suspend(emp, 'incident sécurité', ACTOR);
    expect((await access.resolveEffectiveAccess({ employeeId: emp, storeId: CERGY, accountActive: true })).reason).toBe('ACCOUNT_SUSPENDED');

    await admin.reactivate(emp, ACTOR);
    expect((await access.resolveEffectiveAccess({ employeeId: emp, storeId: CERGY, accountActive: true })).allowed).toBe(true);

    const evs = await events();
    expect(evs).toEqual(expect.arrayContaining(['ACCOUNT_SUSPENDED', 'ACCOUNT_REACTIVATED']));
    expect((await audit.verifyChain()).valid).toBe(true);
  });

  it('re-grant d’un accès révoqué le réactive (STORE_ADDED)', async () => {
    const emp = uuidv4();
    await admin.grantApplicationAccess(emp, { applicationRole: 'STORE_MANAGER' }, ACTOR);
    await admin.grantStoreAccess(emp, CERGY, {}, ACTOR);
    await admin.revokeStoreAccess(emp, CERGY, null, ACTOR);
    const regranted = await admin.grantStoreAccess(emp, CERGY, {}, ACTOR);
    expect(regranted.revokedAt).toBeNull();
    expect((await access.resolveEffectiveAccess({ employeeId: emp, storeId: CERGY, accountActive: true })).allowed).toBe(true);
  });
});
