/**
 * Lot 8 — Alertes de sécurité (score de risque explicable, spec §14).
 *
 * Pure : nouvel appareil, nouveau pays, voyage impossible, échecs répétés — jamais de
 * blocage sur simple changement de ville. Intégration : risk_score écrit + alerte au seuil.
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { UserLoginEventEntity } from '../src/database/entities/user-login-event.entity';
import { UserViewEventEntity } from '../src/database/entities/user-view-event.entity';
import { SecurityAlertService } from '../src/modules/activity-audit/security-alert.service';
import { assessLoginRisk, RISK_ALERT_THRESHOLD } from '../src/modules/activity-audit/security-alert.evaluator';
import { AlertService } from '../src/common/alert/alert.service';

const at = (iso: string) => new Date(iso);

describe('Lot 8 — assessLoginRisk (pur)', () => {
  it('premier login connu (même appareil, même pays) → risque faible', () => {
    const history = [{ success: true, userAgent: 'UA1', countryCode: 'FR', occurredAt: at('2026-07-15T08:00:00Z') }];
    const r = assessLoginRisk({ success: true, userAgent: 'UA1', countryCode: 'FR', occurredAt: at('2026-07-15T09:00:00Z') }, history);
    expect(r.riskScore).toBe(0);
    expect(r.reasons).toEqual([]);
  });

  it('nouvel appareil + nouveau pays → cumule, explicable', () => {
    const history = [{ success: true, userAgent: 'UA1', countryCode: 'FR', occurredAt: at('2026-07-15T08:00:00Z') }];
    const r = assessLoginRisk({ success: true, userAgent: 'UA2', countryCode: 'DE', occurredAt: at('2026-07-16T09:00:00Z') }, history);
    expect(r.reasons).toEqual(expect.arrayContaining(['new_device', 'new_country']));
    expect(r.riskScore).toBeGreaterThan(0);
  });

  it('voyage impossible : autre pays < 2h → risque élevé (≥ seuil)', () => {
    const history = [{ success: true, userAgent: 'UA1', countryCode: 'FR', occurredAt: at('2026-07-15T09:00:00Z') }];
    const r = assessLoginRisk({ success: true, userAgent: 'UA1', countryCode: 'US', occurredAt: at('2026-07-15T09:30:00Z') }, history);
    expect(r.reasons).toContain('impossible_travel');
    expect(r.riskScore).toBeGreaterThanOrEqual(RISK_ALERT_THRESHOLD);
  });

  it('5 échecs récents → repeated_failures', () => {
    const now = at('2026-07-15T09:00:00Z');
    const history = Array.from({ length: 5 }, (_, i) => ({
      success: false,
      userAgent: 'UA1',
      countryCode: 'FR',
      occurredAt: new Date(now.getTime() - (i + 1) * 60000),
    }));
    const r = assessLoginRisk({ success: true, userAgent: 'UA1', countryCode: 'FR', occurredAt: now }, history);
    expect(r.reasons).toContain('repeated_failures');
  });
});

describe('Lot 8 — SecurityAlertService (intégration)', () => {
  let ds: DataSource;
  let loginRepo: ReturnType<DataSource['getRepository']>;
  let svc: SecurityAlertService;

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    loginRepo = ds.getRepository(UserLoginEventEntity);
    svc = new SecurityAlertService(loginRepo as any, ds.getRepository(UserViewEventEntity) as any);
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('écrit le risk_score et lève LOGIN_RISK_HIGH au-delà du seuil', async () => {
    const emp = uuidv4();
    const fire = jest.spyOn(AlertService.instance, 'fire').mockImplementation(() => undefined as any);
    // login antérieur FR
    await loginRepo.save(loginRepo.create({ employeeId: emp, eventType: 'LOGIN_SUCCESS', success: true, userAgent: 'UA1', countryCode: 'FR', occurredAt: new Date('2026-07-15T09:00:00Z') }));
    // login courant US 30 min plus tard → voyage impossible
    const cur = await loginRepo.save(loginRepo.create({ employeeId: emp, eventType: 'LOGIN_SUCCESS', success: true, userAgent: 'UA1', countryCode: 'US', occurredAt: new Date('2026-07-15T09:30:00Z') }));

    const score = await svc.assessAndAlert(emp, cur.id);
    expect(score).toBeGreaterThanOrEqual(RISK_ALERT_THRESHOLD);
    const updated: any = await loginRepo.findOne({ where: { id: cur.id } });
    expect(updated.riskScore).toBe(score);
    expect(fire).toHaveBeenCalledWith('LOGIN_RISK_HIGH', expect.stringContaining('impossible_travel'));
    fire.mockRestore();
  });

  it('non bloquant : employeeId null → 0, aucune erreur', async () => {
    await expect(svc.assessAndAlert(null, uuidv4())).resolves.toBe(0);
  });
});
