/**
 * Lot 2 — AccessService.resolveEffectiveAccess (résolveur d'accès effectif serveur).
 *
 * Couvre les cas §18-1..6 : Cergy autorisé / Évry refusé (403 périmètre), accès temporaire
 * qui expire, révocation immédiate, périmètre multi-magasins, suspension, permission granulaire.
 * Utilise des repos pgmem réels ; `accountActive` est passé pour éviter le graphe FK employés/magasins.
 */
import { DataSource, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { EmployeeEntity } from '../src/database/entities/employee.entity';
import { EmployeeApplicationAccessEntity } from '../src/database/entities/employee-application-access.entity';
import { EmployeeStoreAccessEntity } from '../src/database/entities/employee-store-access.entity';
import { AccessService } from '../src/modules/pilotage-access/access.service';

describe('Lot 2 — AccessService', () => {
  let ds: DataSource;
  let appRepo: Repository<EmployeeApplicationAccessEntity>;
  let storeRepo: Repository<EmployeeStoreAccessEntity>;
  let svc: AccessService;

  const NOW = new Date('2026-07-15T12:00:00Z');
  const CERGY = uuidv4();
  const EVRY = uuidv4();

  const grantApp = (employeeId: string, over: Partial<EmployeeApplicationAccessEntity> = {}) =>
    appRepo.save(appRepo.create({ employeeId, applicationRole: 'STORE_MANAGER', ...over }));

  const grantStore = (employeeId: string, storeId: string, over: Partial<EmployeeStoreAccessEntity> = {}) =>
    storeRepo.save(storeRepo.create({ employeeId, storeId, ...over }));

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    appRepo = ds.getRepository(EmployeeApplicationAccessEntity);
    storeRepo = ds.getRepository(EmployeeStoreAccessEntity);
    svc = new AccessService(appRepo as any, storeRepo as any, ds.getRepository(EmployeeEntity) as any);
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('§18-1/2 — directeur Cergy: Cergy autorisé, Évry refusé (STORE_NOT_IN_SCOPE)', async () => {
    const emp = uuidv4();
    await grantApp(emp);
    await grantStore(emp, CERGY);

    const okCergy = await svc.resolveEffectiveAccess({ employeeId: emp, storeId: CERGY, accountActive: true, at: NOW });
    expect(okCergy.allowed).toBe(true);

    const denyEvry = await svc.resolveEffectiveAccess({ employeeId: emp, storeId: EVRY, accountActive: true, at: NOW });
    expect(denyEvry.allowed).toBe(false);
    expect(denyEvry.reason).toBe('STORE_NOT_IN_SCOPE');
  });

  it('sans accès application → NO_APPLICATION_ACCESS', async () => {
    const res = await svc.resolveEffectiveAccess({ employeeId: uuidv4(), storeId: CERGY, accountActive: true, at: NOW });
    expect(res).toMatchObject({ allowed: false, reason: 'NO_APPLICATION_ACCESS' });
  });

  it('accès application désactivé → NO_APPLICATION_ACCESS', async () => {
    const emp = uuidv4();
    await grantApp(emp, { applicationEnabled: false });
    const res = await svc.resolveEffectiveAccess({ employeeId: emp, storeId: CERGY, accountActive: true, at: NOW });
    expect(res.reason).toBe('NO_APPLICATION_ACCESS');
  });

  it('compte inactif → ACCOUNT_INACTIVE', async () => {
    const emp = uuidv4();
    await grantApp(emp);
    const res = await svc.resolveEffectiveAccess({ employeeId: emp, storeId: CERGY, accountActive: false, at: NOW });
    expect(res.reason).toBe('ACCOUNT_INACTIVE');
  });

  it('compte suspendu → ACCOUNT_SUSPENDED', async () => {
    const emp = uuidv4();
    await grantApp(emp, { suspendedAt: new Date('2026-07-10T00:00:00Z'), suspendedBy: uuidv4() });
    await grantStore(emp, CERGY);
    const res = await svc.resolveEffectiveAccess({ employeeId: emp, storeId: CERGY, accountActive: true, at: NOW });
    expect(res.reason).toBe('ACCOUNT_SUSPENDED');
  });

  it('§18-5 — accès application expiré → ACCESS_EXPIRED', async () => {
    const emp = uuidv4();
    await grantApp(emp, { validUntil: new Date('2026-07-01T00:00:00Z') }); // expiré avant NOW
    await grantStore(emp, CERGY);
    const res = await svc.resolveEffectiveAccess({ employeeId: emp, storeId: CERGY, accountActive: true, at: NOW });
    expect(res.reason).toBe('ACCESS_EXPIRED');
  });

  it('§18-5 — grant magasin expiré → ACCESS_EXPIRED', async () => {
    const emp = uuidv4();
    await grantApp(emp);
    await grantStore(emp, CERGY, { validUntil: new Date('2026-07-01T00:00:00Z') });
    const res = await svc.resolveEffectiveAccess({ employeeId: emp, storeId: CERGY, accountActive: true, at: NOW });
    expect(res.reason).toBe('ACCESS_EXPIRED');
  });

  it('§18-6 — grant révoqué → STORE_NOT_IN_SCOPE (révocation immédiate)', async () => {
    const emp = uuidv4();
    await grantApp(emp);
    await grantStore(emp, CERGY, { revokedAt: new Date('2026-07-14T00:00:00Z'), revokedBy: uuidv4() });
    const res = await svc.resolveEffectiveAccess({ employeeId: emp, storeId: CERGY, accountActive: true, at: NOW });
    expect(res.reason).toBe('STORE_NOT_IN_SCOPE');
  });

  it('permission granulaire: can_view_financials refusée par défaut, autorisée si accordée', async () => {
    const emp = uuidv4();
    await grantApp(emp);
    await grantStore(emp, CERGY); // can_view_financials défaut false
    const denied = await svc.resolveEffectiveAccess({
      employeeId: emp, storeId: CERGY, permission: 'can_view_financials', accountActive: true, at: NOW,
    });
    expect(denied.reason).toBe('PERMISSION_DENIED');

    const emp2 = uuidv4();
    await grantApp(emp2);
    await grantStore(emp2, CERGY, { canViewFinancials: true });
    const ok = await svc.resolveEffectiveAccess({
      employeeId: emp2, storeId: CERGY, permission: 'can_view_financials', accountActive: true, at: NOW,
    });
    expect(ok.allowed).toBe(true);
  });

  it('§18-4 — rôle central (CENTRAL_DIRECTOR): périmètre global, tout magasin sans grant', async () => {
    const emp = uuidv4();
    await grantApp(emp, { applicationRole: 'CENTRAL_DIRECTOR' });
    const res = await svc.resolveEffectiveAccess({ employeeId: emp, storeId: EVRY, accountActive: true, at: NOW });
    expect(res.allowed).toBe(true);
    expect(res.globalScope).toBe(true);

    const scope = await svc.listAccessibleStores(emp, NOW);
    expect(scope.global).toBe(true);
  });

  it('§18-4 — multi-magasins: listAccessibleStores = grants actifs uniquement', async () => {
    const emp = uuidv4();
    await grantApp(emp, { applicationRole: 'MULTI_STORE_MANAGER' });
    await grantStore(emp, CERGY);
    await grantStore(emp, EVRY, { revokedAt: new Date('2026-07-14T00:00:00Z') }); // révoqué → exclu
    const scope = await svc.listAccessibleStores(emp, NOW);
    expect(scope.global).toBe(false);
    expect(scope.storeIds).toEqual([CERGY]);
  });
});
