/**
 * Lot 6 — ActivityService (télémétrie connexions + sessions).
 *
 * Prouve : login réussi/échoué journalisé (§18-7/8), aucun secret stocké (§18-14),
 * IP hachée pour vues masquées, cycle de session, révocation, stats, filtres,
 * et NON-BLOCAGE (une panne d'écriture ne lève jamais, §16/17).
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { UserLoginEventEntity } from '../src/database/entities/user-login-event.entity';
import { UserSessionEntity } from '../src/database/entities/user-session.entity';
import { UserViewEventEntity } from '../src/database/entities/user-view-event.entity';
import { ActivityService } from '../src/modules/activity-audit/activity.service';

describe('Lot 6 — ActivityService', () => {
  let ds: DataSource;
  let loginRepo: ReturnType<DataSource['getRepository']>;
  let sessionRepo: ReturnType<DataSource['getRepository']>;
  let svc: ActivityService;

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    loginRepo = ds.getRepository(UserLoginEventEntity);
    sessionRepo = ds.getRepository(UserSessionEntity);
    svc = new ActivityService(loginRepo as any, sessionRepo as any, ds.getRepository(UserViewEventEntity) as any);
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('§18-7/8/14 — login réussi/échoué journalisés ; IP hachée ; AUCUN secret stocké', async () => {
    const emp = uuidv4();
    await svc.recordLogin({ employeeId: emp, eventType: 'LOGIN_SUCCESS', success: true, authenticationMethod: 'PIN', ipAddress: '203.0.113.7' });
    await svc.recordLogin({ eventType: 'LOGIN_FAILED', success: false, authenticationMethod: 'PIN', ipAddress: '203.0.113.7', failureReason: new Error('Aucun employé trouvé pour ce magasin') });

    const rows: any[] = await loginRepo.find({ order: { occurredAt: 'ASC' } });
    expect(rows.map((r) => r.success)).toEqual([true, false]);
    // IP hachée présente, jamais nulle quand une IP est fournie
    expect(rows[0].ipHash).toBeTruthy();
    expect(rows[0].ipHash).not.toBe('203.0.113.7');
    // Motif d'échec journalisé, borné, sans PIN
    expect(rows[1].failureReason).toContain('Aucun employé');
    // Schéma : AUCUNE colonne de secret
    const keys = Object.keys(rows[0]);
    for (const forbidden of ['pin', 'password', 'pinHash', 'token', 'accessToken', 'refreshToken']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('cycle de session : start → active → end ; révocation globale', async () => {
    const emp = uuidv4();
    const sid = await svc.startSession({ employeeId: emp, ipAddress: '10.0.0.9' });
    expect(sid).toBeTruthy();
    expect((await svc.listSessions({ employeeId: emp, activeOnly: true })).length).toBe(1);

    await svc.endSession(sid, 'logout');
    expect((await svc.listSessions({ employeeId: emp, activeOnly: true })).length).toBe(0);

    // deux sessions actives puis révocation globale
    await svc.startSession({ employeeId: emp });
    await svc.startSession({ employeeId: emp });
    const revoked = await svc.revokeAllSessionsForEmployee(emp, uuidv4(), 'sécurité');
    expect(revoked).toBe(2);
    expect((await svc.listSessions({ employeeId: emp, activeOnly: true })).length).toBe(0);
  });

  it('isNewDevice : vrai au 1er login d’un user-agent, faux ensuite', async () => {
    const emp = uuidv4();
    const ua = 'Mozilla/5.0 TestDevice';
    expect(await svc.isNewDevice(emp, ua)).toBe(true);
    await svc.recordLogin({ employeeId: emp, eventType: 'LOGIN_SUCCESS', success: true, userAgent: ua });
    expect(await svc.isNewDevice(emp, ua)).toBe(false);
  });

  it('stats + filtres : succès/échecs comptés, filtre par employé', async () => {
    const emp = uuidv4();
    await svc.recordLogin({ employeeId: emp, eventType: 'LOGIN_SUCCESS', success: true, userAgent: 'D1' });
    await svc.recordLogin({ employeeId: emp, eventType: 'LOGIN_SUCCESS', success: true, userAgent: 'D2' });
    await svc.recordLogin({ employeeId: emp, eventType: 'LOGIN_FAILED', success: false });

    const stats = await svc.sessionStats(emp);
    expect(stats.totalLogins).toBe(2);
    expect(stats.failedCount).toBe(1);
    expect(stats.distinctDevices).toBe(2);
    expect(stats.lastLoginAt).toBeTruthy();

    const onlyFailed = await svc.listLoginEvents({ employeeId: emp, success: false });
    expect(onlyFailed.total).toBe(1);
  });

  it('§16/17 — NON BLOCANT : une panne d’écriture ne lève jamais', async () => {
    const boom = jest.spyOn(loginRepo, 'save').mockRejectedValueOnce(new Error('db down'));
    await expect(svc.recordLogin({ eventType: 'LOGIN_SUCCESS', success: true })).resolves.toBeUndefined();
    boom.mockRestore();

    const boom2 = jest.spyOn(sessionRepo, 'save').mockRejectedValueOnce(new Error('db down'));
    await expect(svc.startSession({ employeeId: uuidv4() })).resolves.toBeNull();
    boom2.mockRestore();
  });
});
