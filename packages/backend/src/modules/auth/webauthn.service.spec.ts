import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { WebauthnService } from './webauthn.service';
import { AuthService } from './auth.service';
import { AuditService } from '../audit/audit.service';
import { CACHE_STORE } from '../../common/cache/cache.module';
import { EmployeeEntity } from '../../database/entities/employee.entity';
import { WebauthnCredentialEntity } from '../../database/entities/webauthn-credential.entity';

// P370 — passkeys WebAuthn : invariants de sécurité verrouillés.
// La crypto (@simplewebauthn/server) est mockée ici pour contrôler les
// verdicts ; la cérémonie RÉELLE (signatures CTAP2) est couverte par le run
// d'intégration avec l'authenticator virtuel Chrome (voir EXECUTION_LOG).

jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn(async () => ({ challenge: 'reg-challenge' })),
  verifyRegistrationResponse: jest.fn(),
  generateAuthenticationOptions: jest.fn(async () => ({ challenge: 'auth-challenge' })),
  verifyAuthenticationResponse: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const swa = require('@simplewebauthn/server');

/** Petit cache mémoire fidèle au contrat ICacheStore (get/set/del + TTL ignoré). */
function memCache() {
  const m = new Map<string, any>();
  return {
    get: jest.fn(async (k: string) => (m.has(k) ? m.get(k) : null)),
    set: jest.fn(async (k: string, v: any) => void m.set(k, v)),
    del: jest.fn(async (k: string) => void m.delete(k)),
    has: jest.fn(async (k: string) => m.has(k)),
    incr: jest.fn(),
    sadd: jest.fn(),
    sismember: jest.fn(),
    srem: jest.fn(),
  };
}

const EMPLOYEE = {
  id: 'emp-1',
  email: 'omar@wesley.test',
  firstName: 'Omar',
  lastName: 'Direction',
  role: 'admin',
  storeId: 'store-1',
  isActive: true,
  qrCode: 'QR-OMAR',
} as any;

describe('WebauthnService (P370)', () => {
  let service: WebauthnService;
  let cache: ReturnType<typeof memCache>;
  let employeeRepo: { findOne: jest.Mock };
  let credentialRepo: { findOne: jest.Mock; find: jest.Mock; save: jest.Mock; create: jest.Mock };
  let authService: { createSessionForEmployee: jest.Mock };
  let auditService: { log: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    cache = memCache();
    employeeRepo = { findOne: jest.fn() };
    credentialRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (c: any) => ({ id: 'cred-db-1', ...c })),
      create: jest.fn((c: any) => c),
    };
    authService = { createSessionForEmployee: jest.fn(async () => ({ accessToken: 'jwt', employee: EMPLOYEE })) };
    auditService = { log: jest.fn(async () => undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebauthnService,
        { provide: AuthService, useValue: authService },
        { provide: AuditService, useValue: auditService },
        { provide: CACHE_STORE, useValue: cache },
        { provide: getRepositoryToken(EmployeeEntity), useValue: employeeRepo },
        { provide: getRepositoryToken(WebauthnCredentialEntity), useValue: credentialRepo },
      ],
    }).compile();
    service = module.get(WebauthnService);
  });

  const goodAuthResponse = { id: 'cred-abc', response: {} };
  const activeCred = {
    id: 'cred-db-1',
    employeeId: EMPLOYEE.id,
    credentialId: 'cred-abc',
    publicKey: Buffer.from('pub').toString('base64url'),
    counter: '5',
    transports: null,
    deviceName: "iPhone d'Omar",
    revokedAt: null,
  } as any;

  describe('enregistrement', () => {
    it('challenge à usage unique : un rejeu de verify échoue en « expiré »', async () => {
      employeeRepo.findOne.mockResolvedValue(EMPLOYEE);
      swa.verifyRegistrationResponse.mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: { id: 'cred-abc', publicKey: new Uint8Array([1]), counter: 0 },
          credentialDeviceType: 'multiDevice',
          credentialBackedUp: true,
          aaguid: 'aa',
        },
      });
      await service.registrationOptions(EMPLOYEE.id);
      await service.verifyRegistration(EMPLOYEE.id, { response: {}, deviceName: "iPhone d'Omar" });
      await expect(
        service.verifyRegistration(EMPLOYEE.id, { response: {}, deviceName: 'rejeu' }),
      ).rejects.toThrow(/expiré ou déjà utilisé/);
    });

    it("ne stocke QUE des informations publiques (clé publique, compteur, nom)", async () => {
      employeeRepo.findOne.mockResolvedValue(EMPLOYEE);
      swa.verifyRegistrationResponse.mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: { id: 'cred-abc', publicKey: new Uint8Array([1, 2]), counter: 0, transports: ['internal'] },
          credentialDeviceType: 'singleDevice',
          credentialBackedUp: false,
          aaguid: 'aa',
        },
      });
      await service.registrationOptions(EMPLOYEE.id);
      await service.verifyRegistration(EMPLOYEE.id, { response: {}, deviceName: "MacBook d'Omar" });
      const saved = credentialRepo.save.mock.calls[0][0];
      expect(Object.keys(saved).sort()).toEqual(
        ['aaguid', 'backedUp', 'counter', 'credentialId', 'deviceName', 'deviceType', 'employeeId', 'publicKey', 'transports'].sort(),
      );
      expect(saved.publicKey).toEqual(Buffer.from([1, 2]).toString('base64url'));
      // Enregistrement journalisé.
      expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'webauthn_register' }));
    });

    it('compte désactivé : options refusées', async () => {
      employeeRepo.findOne.mockResolvedValue(null);
      await expect(service.registrationOptions('ghost')).rejects.toThrow(/introuvable ou désactivé/);
    });
  });

  describe('authentification', () => {
    const arm = async () => {
      const { challengeId } = await service.authenticationOptions();
      return challengeId;
    };

    it('challenge inexistant/expiré → refus', async () => {
      await expect(
        service.verifyAuthentication({ challengeId: 'jamais-vu', response: goodAuthResponse }),
      ).rejects.toThrow(/expiré ou déjà utilisé/);
    });

    it('challenge réutilisé (rejeu) → refus au second passage', async () => {
      const challengeId = await arm();
      credentialRepo.findOne.mockResolvedValue(activeCred);
      employeeRepo.findOne.mockResolvedValue(EMPLOYEE);
      swa.verifyAuthenticationResponse.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 6 } });
      await service.verifyAuthentication({ challengeId, response: goodAuthResponse });
      await expect(
        service.verifyAuthentication({ challengeId, response: goodAuthResponse }),
      ).rejects.toThrow(/expiré ou déjà utilisé/);
    });

    it('credential inconnue → refus (aucun compte deviné)', async () => {
      const challengeId = await arm();
      credentialRepo.findOne.mockResolvedValue(null);
      await expect(
        service.verifyAuthentication({ challengeId, response: goodAuthResponse }),
      ).rejects.toThrow(/inconnue ou révoquée/);
    });

    it('credential révoquée → refus immédiat', async () => {
      const challengeId = await arm();
      credentialRepo.findOne.mockResolvedValue({ ...activeCred, revokedAt: new Date() });
      await expect(
        service.verifyAuthentication({ challengeId, response: goodAuthResponse }),
      ).rejects.toThrow(/inconnue ou révoquée/);
    });

    it('compte désactivé → refus même avec une passkey valide', async () => {
      const challengeId = await arm();
      credentialRepo.findOne.mockResolvedValue(activeCred);
      employeeRepo.findOne.mockResolvedValue({ ...EMPLOYEE, isActive: false });
      await expect(
        service.verifyAuthentication({ challengeId, response: goodAuthResponse }),
      ).rejects.toThrow(/désactivé/);
    });

    it('mauvaise origin/RP (verif crypto rejetée) → refus', async () => {
      const challengeId = await arm();
      credentialRepo.findOne.mockResolvedValue(activeCred);
      employeeRepo.findOne.mockResolvedValue(EMPLOYEE);
      swa.verifyAuthenticationResponse.mockRejectedValue(new Error('Unexpected authentication response origin'));
      await expect(
        service.verifyAuthentication({ challengeId, response: goodAuthResponse }),
      ).rejects.toThrow(/refusée/);
    });

    it('compteur en régression (clonage possible) → refus + audit anomalie', async () => {
      const challengeId = await arm();
      credentialRepo.findOne.mockResolvedValue({ ...activeCred, counter: '10' });
      employeeRepo.findOne.mockResolvedValue(EMPLOYEE);
      swa.verifyAuthenticationResponse.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 3 } });
      await expect(
        service.verifyAuthentication({ challengeId, response: goodAuthResponse }),
      ).rejects.toThrow(/compteur/);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'webauthn_counter_anomaly' }),
      );
    });

    it('succès : la session vient de createSessionForEmployee (droits relus en base, jamais de la passkey)', async () => {
      const challengeId = await arm();
      credentialRepo.findOne.mockResolvedValue({ ...activeCred, counter: '5' });
      employeeRepo.findOne.mockResolvedValue({ ...EMPLOYEE, role: 'manager' }); // droits ACTUELS
      swa.verifyAuthenticationResponse.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 6 } });
      const session = await service.verifyAuthentication({ challengeId, response: goodAuthResponse });
      expect(authService.createSessionForEmployee).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'manager' }),
      );
      expect(session).toEqual(expect.objectContaining({ accessToken: 'jwt' }));
      // compteur + dernière utilisation mis à jour
      expect(credentialRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ counter: '6', lastUsedAt: expect.any(Date) }),
      );
      expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'webauthn_login' }));
    });
  });

  describe('gestion des clés (compte du JWT uniquement)', () => {
    it('renommer/révoquer une clé d’un AUTRE compte → introuvable (anti-usurpation)', async () => {
      credentialRepo.findOne.mockResolvedValue(null); // where {id, employeeId} ne matche pas
      await expect(service.rename('emp-2', 'cred-db-1', 'Pirate')).rejects.toThrow(/introuvable/);
      await expect(service.revoke('emp-2', 'cred-db-1')).rejects.toThrow(/introuvable/);
    });

    it('révocation : horodatée + journalisée dans l’audit de sécurité', async () => {
      credentialRepo.findOne
        .mockResolvedValueOnce({ ...activeCred })
        .mockResolvedValueOnce(EMPLOYEE as any);
      employeeRepo.findOne.mockResolvedValue(EMPLOYEE);
      const dto = await service.revoke(EMPLOYEE.id, 'cred-db-1');
      expect(dto.revokedAt).toBeInstanceOf(Date);
      expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'webauthn_revoke' }));
    });

    it('la liste ne renvoie jamais la clé publique ni d’identifiant de credential', async () => {
      credentialRepo.find.mockResolvedValue([activeCred]);
      const [dto] = await service.list(EMPLOYEE.id);
      expect(dto).not.toHaveProperty('publicKey');
      expect(dto).not.toHaveProperty('credentialId');
      expect(dto.deviceName).toBe("iPhone d'Omar");
    });
  });
});
