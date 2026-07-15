/**
 * Lot 7 — ActivityService.recordView : journal des consultations.
 *
 * Prouve : action métier whitelistée acceptée (§18-10), action arbitraire REFUSÉE
 * (anti-injection §15), métadonnée NETTOYÉE de tout secret (§18-14), ACCESS_DENIED
 * journalisé (§18-3), filtres, non-blocage.
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { UserLoginEventEntity } from '../src/database/entities/user-login-event.entity';
import { UserSessionEntity } from '../src/database/entities/user-session.entity';
import { UserViewEventEntity } from '../src/database/entities/user-view-event.entity';
import { ActivityService } from '../src/modules/activity-audit/activity.service';

describe('Lot 7 — ActivityService.recordView', () => {
  let ds: DataSource;
  let viewRepo: ReturnType<DataSource['getRepository']>;
  let svc: ActivityService;

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    viewRepo = ds.getRepository(UserViewEventEntity);
    svc = new ActivityService(
      ds.getRepository(UserLoginEventEntity) as any,
      ds.getRepository(UserSessionEntity) as any,
      viewRepo as any,
    );
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('§18-10 — action métier pointée acceptée + stockée', async () => {
    const emp = uuidv4();
    const ok = await svc.recordView({ employeeId: emp, storeId: 'cergy', module: 'dashboard', action: 'dashboard.kpi.revenue.open' });
    expect(ok).toBe(true);
    const rows: any[] = await viewRepo.find({ where: { employeeId: emp } });
    expect(rows.length).toBe(1);
    expect(rows[0].action).toBe('dashboard.kpi.revenue.open');
  });

  it('action énumérée (STORE_COMPARE, ACCESS_DENIED) acceptée', async () => {
    expect(await svc.recordView({ employeeId: uuidv4(), action: 'STORE_COMPARE' })).toBe(true);
    expect(await svc.recordView({ employeeId: uuidv4(), storeId: 'evry', action: 'ACCESS_DENIED' })).toBe(true);
  });

  it('§15 — action NON whitelistée refusée (rien écrit)', async () => {
    const emp = uuidv4();
    const before = await viewRepo.count();
    const ok = await svc.recordView({ employeeId: emp, action: 'DROP TABLE sales; --' });
    expect(ok).toBe(false);
    expect(await viewRepo.count()).toBe(before);
  });

  it('§18-14 — métadonnée NETTOYÉE : password/token/pan retirés, taille bornée', async () => {
    const emp = uuidv4();
    await svc.recordView({
      employeeId: emp,
      action: 'FILTER_APPLIED',
      metadata: { filter: 'ca>1000', password: 'hunter2', token: 'jwt.abc', card: { pan: '4111111111111111' }, note: 'x'.repeat(2000) },
    });
    const row: any = await viewRepo.findOne({ where: { employeeId: emp } });
    const md = row.metadataJson;
    expect(md.filter).toBe('ca>1000');
    expect(md).not.toHaveProperty('password');
    expect(md).not.toHaveProperty('token');
    expect(md).not.toHaveProperty('card'); // clé sensible retirée en profondeur
    expect(md.note.length).toBeLessThanOrEqual(500); // bornée
  });

  it('filtres : par employé + action', async () => {
    const emp = uuidv4();
    await svc.recordView({ employeeId: emp, storeId: 'cergy', action: 'STORE_SELECTED' });
    await svc.recordView({ employeeId: emp, action: 'EXPORT_REQUESTED' });
    const exportsOnly = await svc.listViewEvents({ employeeId: emp, action: 'EXPORT_REQUESTED' });
    expect(exportsOnly.total).toBe(1);
  });

  it('non bloquant : une panne d’écriture retourne false sans lever', async () => {
    const boom = jest.spyOn(viewRepo, 'save').mockRejectedValueOnce(new Error('db down'));
    await expect(svc.recordView({ employeeId: uuidv4(), action: 'PAGE_VIEW' })).resolves.toBe(false);
    boom.mockRestore();
  });
});
