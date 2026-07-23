/**
 * Lot 6 — hooks de télémétrie dans AuthService : STRICTEMENT non bloquants et sans secret.
 *
 * Garantit qu'une panne de télémétrie ne peut jamais impacter l'authentification (§16/17)
 * et qu'aucun PIN/mot de passe n'est transmis à la journalisation (§18-8/14).
 * AuthService est construit avec des deps nulles : seul `this.activity` est exercé.
 */
import { AuthService } from '../src/modules/auth/auth.service';

const makeSvc = (activity: any) =>
  new AuthService(
    null as any, // storeRepo
    null as any, // employeeRepo
    null as any, // jwtService
    null as any, // timewin
    null as any, // cache
    null as any, // auditService
    activity, // @Optional() ActivityService
  );

describe('Lot 6 — AuthService télémétrie', () => {
  it('§16/17 — une ActivityService qui lève est avalée (auth jamais impactée)', async () => {
    const throwing = {
      isNewDevice: jest.fn().mockRejectedValue(new Error('db down')),
      startSession: jest.fn().mockRejectedValue(new Error('db down')),
      recordLogin: jest.fn().mockRejectedValue(new Error('db down')),
      endActiveSessionsForEmployee: jest.fn().mockRejectedValue(new Error('db down')),
    };
    const svc = makeSvc(throwing);
    await expect(
      (svc as any).recordLoginTelemetry('success', 'PIN', '1.2.3.4', { userAgent: 'UA' }, { employee: { id: 'e1' } }),
    ).resolves.toBeUndefined();
    await expect(
      (svc as any).recordLoginTelemetry('failure', 'PIN', '1.2.3.4', {}, undefined, new Error('bad pin')),
    ).resolves.toBeUndefined();
    await expect((svc as any).recordLogoutTelemetry('e1')).resolves.toBeUndefined();
  });

  it('ActivityService absente (dep optionnelle) → no-op', async () => {
    const svc = makeSvc(undefined);
    await expect(
      (svc as any).recordLoginTelemetry('success', 'PIN', '1.2.3.4', {}, { employee: { id: 'e' } }),
    ).resolves.toBeUndefined();
    await expect((svc as any).recordLogoutTelemetry('e')).resolves.toBeUndefined();
  });

  it('§18-14 — l’échec ne transmet AUCUN pin/mot de passe à recordLogin', async () => {
    const rec = jest.fn().mockResolvedValue(undefined);
    const svc = makeSvc({ isNewDevice: jest.fn(), startSession: jest.fn(), recordLogin: rec });
    await (svc as any).recordLoginTelemetry('failure', 'PIN', '1.2.3.4', { userAgent: 'UA' }, undefined, new Error('Aucun employé'));
    expect(rec).toHaveBeenCalledTimes(1);
    const arg = rec.mock.calls[0][0];
    expect(arg.success).toBe(false);
    expect(arg).not.toHaveProperty('pin');
    expect(arg).not.toHaveProperty('password');
  });

  it('le succès crée une session + LOGIN_SUCCESS avec l’employeeId', async () => {
    let logged: any;
    const activity = {
      isNewDevice: jest.fn().mockResolvedValue(false),
      startSession: jest.fn().mockResolvedValue('sess-1'),
      recordLogin: jest.fn((p: any) => {
        logged = p;
        return Promise.resolve();
      }),
    };
    const svc = makeSvc(activity);
    await (svc as any).recordLoginTelemetry('success', 'PIN', '9.9.9.9', { userAgent: 'UA' }, { employee: { id: 'emp-42' } });
    expect(activity.startSession).toHaveBeenCalled();
    expect(logged).toMatchObject({
      employeeId: 'emp-42',
      sessionId: 'sess-1',
      eventType: 'LOGIN_SUCCESS',
      success: true,
      authenticationMethod: 'PIN',
    });
  });
});
