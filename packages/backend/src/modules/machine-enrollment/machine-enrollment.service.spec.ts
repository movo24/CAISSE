import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  MachineEnrollmentService,
  evaluateEnrollmentGate,
} from './machine-enrollment.service';
import { PosMachineEntity } from '../../database/entities/pos-machine.entity';
import { StoreEntity } from '../../database/entities/store.entity';

const STORE = 'store-1';
const OTHER_STORE = 'store-2';

describe('evaluateEnrollmentGate (décision pure)', () => {
  it('magasin sans enrôlement appliqué → toujours autorisé', () => {
    expect(evaluateEnrollmentGate({ enforced: false, storeId: STORE, machine: null }))
      .toEqual({ allowed: true });
  });

  it('enrôlement appliqué + machine approuvée du bon magasin → autorisé', () => {
    const r = evaluateEnrollmentGate({
      enforced: true,
      storeId: STORE,
      machine: { status: 'approved', storeId: STORE },
    });
    expect(r.allowed).toBe(true);
  });

  it('enrôlement appliqué + machine inconnue → bloqué (MACHINE_NOT_ENROLLED)', () => {
    expect(evaluateEnrollmentGate({ enforced: true, storeId: STORE, machine: null }))
      .toEqual({ allowed: false, reason: 'MACHINE_NOT_ENROLLED' });
  });

  it('enrôlement appliqué + machine pending → bloqué', () => {
    const r = evaluateEnrollmentGate({
      enforced: true,
      storeId: STORE,
      machine: { status: 'pending', storeId: STORE },
    });
    expect(r).toEqual({ allowed: false, reason: 'MACHINE_PENDING' });
  });

  it('enrôlement appliqué + machine révoquée → bloqué', () => {
    const r = evaluateEnrollmentGate({
      enforced: true,
      storeId: STORE,
      machine: { status: 'revoked', storeId: STORE },
    });
    expect(r).toEqual({ allowed: false, reason: 'MACHINE_REVOKED' });
  });

  it('machine approuvée mais d’un AUTRE magasin → bloqué (MACHINE_STORE_MISMATCH)', () => {
    const r = evaluateEnrollmentGate({
      enforced: true,
      storeId: STORE,
      machine: { status: 'approved', storeId: OTHER_STORE },
    });
    expect(r).toEqual({ allowed: false, reason: 'MACHINE_STORE_MISMATCH' });
  });
});

describe('MachineEnrollmentService', () => {
  let service: MachineEnrollmentService;
  let repo: any;
  let store: Map<string, PosMachineEntity>;

  beforeEach(async () => {
    store = new Map();
    repo = {
      findOne: jest.fn(async ({ where }: any) => {
        for (const m of store.values()) {
          if (where.id && m.id === where.id) return m;
          if (where.machineId && m.machineId === where.machineId) return m;
        }
        return null;
      }),
      find: jest.fn(async ({ where }: any) => {
        return [...store.values()].filter(
          (m) =>
            m.storeId === where.storeId &&
            (where.status ? m.status === where.status : true),
        );
      }),
      create: jest.fn((data: Partial<PosMachineEntity>) => ({ ...data }) as PosMachineEntity),
      save: jest.fn(async (m: PosMachineEntity) => {
        if (!m.id) m.id = `m-${store.size + 1}`;
        store.set(m.id, m);
        return m;
      }),
    };

    const storeRepo = {
      findOne: jest.fn().mockResolvedValue({ id: STORE, enrollmentEnforced: false }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MachineEnrollmentService,
        { provide: getRepositoryToken(PosMachineEntity), useValue: repo },
        { provide: getRepositoryToken(StoreEntity), useValue: storeRepo },
      ],
    }).compile();

    service = module.get(MachineEnrollmentService);
  });

  it('nouvelle demande → status pending, magasin issu du tenant', async () => {
    const m = await service.requestEnrollment(STORE, {
      machineId: 'MC-ABC',
      terminalLabel: 'Caisse 1',
    }, 'emp-1');
    expect(m.status).toBe('pending');
    expect(m.storeId).toBe(STORE);
    expect(m.requestedBy).toBe('emp-1');
  });

  it('re-déclaration idempotente : même machineId ne crée pas de doublon', async () => {
    await service.requestEnrollment(STORE, { machineId: 'MC-DUP', terminalLabel: 'Caisse 1' });
    await service.requestEnrollment(STORE, { machineId: 'MC-DUP', terminalLabel: 'Caisse 1 (renommée)' });
    const all = await service.listByStore(STORE);
    expect(all).toHaveLength(1);
    expect(all[0].terminalLabel).toBe('Caisse 1 (renommée)');
  });

  it('une machine APPROUVÉE reste approuvée après re-déclaration (pas de régression)', async () => {
    const m = await service.requestEnrollment(STORE, { machineId: 'MC-OK', terminalLabel: 'C1' });
    await service.approve(m.id, 'emp-manager');
    const again = await service.requestEnrollment(STORE, { machineId: 'MC-OK', terminalLabel: 'C1' });
    expect(again.status).toBe('approved');
  });

  it('une machine REJETÉE peut se re-soumettre → repasse pending', async () => {
    const m = await service.requestEnrollment(STORE, { machineId: 'MC-RJ', terminalLabel: 'C1' });
    await service.reject(m.id, 'emp-manager', 'test');
    const again = await service.requestEnrollment(STORE, { machineId: 'MC-RJ', terminalLabel: 'C1' });
    expect(again.status).toBe('pending');
    expect(again.decidedBy).toBeNull();
  });

  it('re-déclaration vers un AUTRE magasin ré-ouvre une demande pending', async () => {
    const m = await service.requestEnrollment(STORE, { machineId: 'MC-MOVE', terminalLabel: 'C1' });
    await service.approve(m.id, 'emp-manager');
    const moved = await service.requestEnrollment(OTHER_STORE, { machineId: 'MC-MOVE', terminalLabel: 'C1' });
    expect(moved.storeId).toBe(OTHER_STORE);
    expect(moved.status).toBe('pending');
  });

  it('approve / reject / revoke posent la trace de décision', async () => {
    const m = await service.requestEnrollment(STORE, { machineId: 'MC-TR', terminalLabel: 'C1' });
    const a = await service.approve(m.id, 'mgr');
    expect(a.status).toBe('approved');
    expect(a.decidedBy).toBe('mgr');
    expect(a.decidedAt).toBeInstanceOf(Date);
    const rv = await service.revoke(m.id, 'mgr', 'vol suspecté');
    expect(rv.status).toBe('revoked');
    expect(rv.decisionReason).toBe('vol suspecté');
  });

  it('listByStore filtre par statut', async () => {
    const a = await service.requestEnrollment(STORE, { machineId: 'A', terminalLabel: 'C1' });
    await service.requestEnrollment(STORE, { machineId: 'B', terminalLabel: 'C2' });
    await service.approve(a.id, 'mgr');
    const pending = await service.listByStore(STORE, 'pending');
    const approved = await service.listByStore(STORE, 'approved');
    expect(pending.map((m) => m.machineId)).toEqual(['B']);
    expect(approved.map((m) => m.machineId)).toEqual(['A']);
  });
});
