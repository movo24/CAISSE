/**
 * Lot 4 — access_audit_log : chaîne immuable des droits (miroir audit-chain-verify).
 *
 * Prouve : chaîne écrite via append() vérifiable + recompute-verifiable (hashed_at posé) ;
 * altération d'une valeur → hash_mismatch ; ré-attribution de l'acteur → hash_mismatch ;
 * suppression d'une ligne → linkage ; retry anti-fork sur 23505 ; alerte à l'épuisement.
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { AccessAuditLogEntity } from '../src/database/entities/access-audit-log.entity';
import { AccessAuditService } from '../src/modules/pilotage-access/access-audit.service';
import { AlertService } from '../src/common/alert/alert.service';

describe('Lot 4 — AccessAuditService (chaîne de hash)', () => {
  let ds: DataSource;
  let svc: AccessAuditService;
  let repo: ReturnType<DataSource['getRepository']>;

  const append = (eventType: any, over: any = {}) =>
    svc.append({ actorEmployeeId: 'admin-1', eventType, targetEmployeeId: 'emp-9', ...over });

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    repo = ds.getRepository(AccessAuditLogEntity);
    svc = new AccessAuditService(repo as any);
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('une chaîne écrite via append() se vérifie ; chaque ligne est recompute-verifiable', async () => {
    await append('ACCESS_GRANTED', { newValue: { storeId: 'cergy', role: 'STORE_MANAGER' } });
    await append('STORE_ADDED', { storeId: 'evry', newValue: { can_view_financials: true } });
    await append('ROLE_CHANGED', { previousValue: { role: 'STORE_MANAGER' }, newValue: { role: 'REGIONAL_MANAGER' } });
    const res = await svc.verifyChain();
    expect(res.valid).toBe(true);
    const rows: any[] = await repo.find();
    expect(rows.length).toBe(3);
    expect(rows.every((r) => typeof r.hashedAt === 'string' && r.hashedAt.length > 0)).toBe(true);
  });

  it('DÉCISIF — altérer new_value est détecté (hash_mismatch)', async () => {
    const scope = uuidv4();
    const e = await svc.append({ scope, actorEmployeeId: 'a', eventType: 'ACCESS_GRANTED', newValue: { role: 'STORE_MANAGER' } });
    await repo.update(e.id, { newValue: { role: 'CENTRAL_ADMIN' } }); // escalade masquée
    const res = await svc.verifyChain(scope);
    expect(res).toMatchObject({ valid: false, brokenAt: e.id, reason: 'hash_mismatch' });
  });

  it('ré-attribuer l’acteur (actor_employee_id) est détecté (hash_mismatch)', async () => {
    const scope = uuidv4();
    const e = await svc.append({ scope, actorEmployeeId: 'real-admin', eventType: 'ACCOUNT_SUSPENDED' });
    await repo.update(e.id, { actorEmployeeId: 'patsy' }); // rejeter la faute sur un collègue
    const res = await svc.verifyChain(scope);
    expect(res.reason).toBe('hash_mismatch');
  });

  it('supprimer une ligne au milieu casse la chaîne (linkage)', async () => {
    const scope = uuidv4();
    await svc.append({ scope, actorEmployeeId: 'a', eventType: 'ACCESS_GRANTED' });
    const mid = await svc.append({ scope, actorEmployeeId: 'a', eventType: 'STORE_ADDED' });
    await svc.append({ scope, actorEmployeeId: 'a', eventType: 'ROLE_CHANGED' });
    await repo.delete(mid.id);
    const res = await svc.verifyChain(scope);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('linkage');
  });

  it('anti-fork : un conflit 23505 déclenche un retry qui réussit', async () => {
    const scope = uuidv4();
    await svc.append({ scope, actorEmployeeId: 'a', eventType: 'ACCESS_GRANTED' });
    const realSave = repo.save.bind(repo);
    let calls = 0;
    const spy = jest.spyOn(repo, 'save').mockImplementation((entity: any) => {
      calls += 1;
      if (calls === 1) return Promise.reject({ code: '23505', message: 'duplicate key' });
      return realSave(entity);
    });
    const e = await svc.append({ scope, actorEmployeeId: 'a', eventType: 'STORE_ADDED' });
    expect(e.id).toBeTruthy();
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
    expect((await svc.verifyChain(scope)).valid).toBe(true);
  });

  it('épuisement des retries → alerte critique + throw', async () => {
    const scope = uuidv4();
    const fire = jest.spyOn(AlertService.instance, 'fire').mockImplementation(() => undefined as any);
    const spy = jest.spyOn(repo, 'save').mockRejectedValue({ code: '23505', message: 'duplicate key' } as any);
    await expect(svc.append({ scope, actorEmployeeId: 'a', eventType: 'ACCESS_GRANTED' })).rejects.toBeDefined();
    expect(fire).toHaveBeenCalledWith('ACCESS_AUDIT_WRITE_FAILED', expect.any(String));
    spy.mockRestore();
    fire.mockRestore();
  });
});
