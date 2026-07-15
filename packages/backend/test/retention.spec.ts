/**
 * Lot 9 — RetentionService.purgeExpired (spec §16).
 *
 * Prouve : suppression des lignes expirées, conservation des récentes, ACCESS_DENIED
 * conservé plus longtemps, géo effacée au-delà de sa durée (ligne conservée), et
 * access_audit_log JAMAIS touché. Purge désactivée par défaut (opt-in).
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { UserLoginEventEntity } from '../src/database/entities/user-login-event.entity';
import { UserViewEventEntity } from '../src/database/entities/user-view-event.entity';
import { UserSessionEntity } from '../src/database/entities/user-session.entity';
import { AccessAuditLogEntity } from '../src/database/entities/access-audit-log.entity';
import { RetentionService } from '../src/modules/activity-audit/retention.service';
import { loadRetentionConfig } from '../src/modules/activity-audit/retention.config';
import { AccessAuditService } from '../src/modules/pilotage-access/access-audit.service';

const NOW = new Date('2026-07-15T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 864e5);

describe('Lot 9 — RetentionService', () => {
  let ds: DataSource;
  let loginRepo: ReturnType<DataSource['getRepository']>;
  let viewRepo: ReturnType<DataSource['getRepository']>;
  let sessionRepo: ReturnType<DataSource['getRepository']>;
  let svc: RetentionService;

  const cfg = loadRetentionConfig({} as any); // defaults: login 365, view 90, denied 365, session 365, geo 90

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    loginRepo = ds.getRepository(UserLoginEventEntity);
    viewRepo = ds.getRepository(UserViewEventEntity);
    sessionRepo = ds.getRepository(UserSessionEntity);
    svc = new RetentionService(loginRepo as any, viewRepo as any, sessionRepo as any);
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('purge par défaut désactivée (opt-in)', () => {
    expect(loadRetentionConfig({} as any).enabled).toBe(false);
    expect(loadRetentionConfig({ RETENTION_PURGE_ENABLED: 'true' } as any).enabled).toBe(true);
  });

  it('supprime les expirés, conserve les récents ; ACCESS_DENIED gardé plus longtemps ; géo effacée', async () => {
    // login events : un vieux (400j > 365) supprimé, un récent conservé
    await loginRepo.save(loginRepo.create({ employeeId: 'e', eventType: 'LOGIN_SUCCESS', success: true, occurredAt: daysAgo(400) }));
    await loginRepo.save(loginRepo.create({ employeeId: 'e', eventType: 'LOGIN_SUCCESS', success: true, occurredAt: daysAgo(10) }));
    // login géo à 120j (>90) : ligne conservée, géo effacée
    const geoRow = await loginRepo.save(
      loginRepo.create({ employeeId: 'e', eventType: 'LOGIN_SUCCESS', success: true, occurredAt: daysAgo(120), countryCode: 'FR', city: 'Paris' }),
    );
    // view events : détaillé vieux (100j > 90) supprimé ; ACCESS_DENIED 100j conservé (< 365)
    await viewRepo.save(viewRepo.create({ employeeId: 'e', action: 'PAGE_VIEW', occurredAt: daysAgo(100) }));
    await viewRepo.save(viewRepo.create({ employeeId: 'e', action: 'ACCESS_DENIED', occurredAt: daysAgo(100) }));
    // session terminée ancienne (400j) supprimée
    await sessionRepo.save(sessionRepo.create({ employeeId: 'e', startedAt: daysAgo(400), endedAt: daysAgo(399) }));

    const res = await svc.purgeExpired(NOW, cfg);
    expect(res.loginEvents).toBe(1); // le vieux login
    expect(res.viewEvents).toBe(1); // le PAGE_VIEW détaillé
    expect(res.accessDenied).toBe(0); // conservé (100j < 365)
    expect(res.sessions).toBe(1);
    expect(res.geoScrubbed).toBe(1);

    // géo effacée mais ligne conservée
    const g: any = await loginRepo.findOne({ where: { id: geoRow.id } });
    expect(g).toBeTruthy();
    expect(g.countryCode).toBeNull();
    expect(g.city).toBeNull();

    // ACCESS_DENIED toujours là
    expect(await viewRepo.count({ where: { action: 'ACCESS_DENIED' } })).toBe(1);
  });

  it('n’altère JAMAIS access_audit_log', async () => {
    const auditRepo = ds.getRepository(AccessAuditLogEntity);
    const audit = new AccessAuditService(auditRepo as any);
    await audit.append({ actorEmployeeId: 'a', eventType: 'ACCESS_GRANTED', targetEmployeeId: 't' });
    const before = await auditRepo.count();

    await svc.purgeExpired(NOW, cfg);

    expect(await auditRepo.count()).toBe(before);
    expect((await audit.verifyChain()).valid).toBe(true);
  });
});
