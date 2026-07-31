import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock l'API AVANT d'importer le store (même patron que posSession.test.ts).
const { open, active, close, setOpeningCash, logout, logEvent } = vi.hoisted(() => ({
  open: vi.fn(),
  active: vi.fn(),
  close: vi.fn(),
  setOpeningCash: vi.fn().mockResolvedValue(undefined),
  logout: vi.fn().mockResolvedValue(undefined),
  logEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/api', () => ({
  authApi: { logout },
  posSessionApi: {
    open: (amount?: number) => Promise.resolve(open(amount)),
    close: (id: string, counted?: number) => Promise.resolve(close(id, counted)),
    active: () => Promise.resolve(active()),
    setOpeningCash: () => Promise.resolve(undefined),
  },
  employeeScoreApi: { logEvent: (d: unknown) => Promise.resolve(logEvent(d)) },
  posTerminalId: () => 'TERMINAL 01',
}));

import {
  usePOSStore,
  describeSessionError,
  isServerDownError,
} from './posStore';

const emp = { id: 'emp-1', firstName: 'K', lastName: 'B', role: 'cashier', storeId: 'store-1' };

function setBypass(enabled: boolean, stores = '', terminals = '') {
  (globalThis as any).posDesktop = { sessionTestBypass: { enabled, stores, terminals } };
}

beforeEach(() => {
  open.mockReset();
  active.mockReset();
  localStorage.clear();
  delete (globalThis as any).posDesktop;
  usePOSStore.setState({
    employee: emp as never,
    storeInfo: null as never,
    posSession: null,
    posSessionOpenFailed: true,
    sessionReopenOffered: false,
    sessionReopenError: null,
    openingCashRequired: false,
  });
});
afterEach(() => {
  delete (globalThis as any).posDesktop;
});

describe('describeSessionError — code HTTP réel + identifiant, jamais générique', () => {
  it('extrait le statut HTTP et le message serveur, avec un errorId', () => {
    const d = describeSessionError({ response: { status: 500, data: { message: 'boom' } } });
    expect(d.status).toBe(500);
    expect(d.kind).toBe('http');
    expect(d.message).toContain('HTTP 500');
    expect(d.message).toContain('boom');
    expect(d.errorId).toMatch(/^ERR-/);
  });
  it('distingue timeout et réseau quand il n’y a pas de réponse', () => {
    expect(describeSessionError({ code: 'ECONNABORTED' }).kind).toBe('timeout');
    expect(describeSessionError({ message: 'Network Error' }).kind).toBe('network');
  });
});

describe('isServerDownError — 5xx/timeout justifient la session locale provisoire', () => {
  it('vrai pour 500 et timeout, faux pour 401/403/409/réseau', () => {
    expect(isServerDownError(describeSessionError({ response: { status: 500 } }))).toBe(true);
    expect(isServerDownError(describeSessionError({ code: 'ECONNABORTED' }))).toBe(true);
    expect(isServerDownError(describeSessionError({ response: { status: 401 } }))).toBe(false);
    expect(isServerDownError(describeSessionError({ response: { status: 409 } }))).toBe(false);
    expect(isServerDownError(describeSessionError({ message: 'Network Error' }))).toBe(false);
  });
});

describe('reopenSessionWithFloat — 500 serveur', () => {
  it('SANS mode test : échec, aucune session, code réel exposé (pas de générique)', async () => {
    open.mockRejectedValue({ response: { status: 500, data: { message: 'column does not exist' } } });
    active.mockRejectedValue({ response: { status: 500 } });
    const ok = await usePOSStore.getState().reopenSessionWithFloat(18750);
    expect(ok).toBe(false);
    const st = usePOSStore.getState();
    expect(st.posSession).toBeNull();
    expect(st.sessionReopenError?.status).toBe(500);
    expect(st.sessionReopenError?.errorId).toMatch(/^ERR-/);
  });

  it('AVEC mode test (magasin/terminal pilotes) : session LOCALE provisoire, verrou levé', async () => {
    setBypass(true, 'store-1', 'TERMINAL 01');
    open.mockRejectedValue({ response: { status: 500 } });
    active.mockRejectedValue({ response: { status: 500 } });
    const ok = await usePOSStore.getState().reopenSessionWithFloat(18750);
    expect(ok).toBe(true);
    const st = usePOSStore.getState();
    expect(st.posSession?.provisional).toBe(true);
    expect(st.posSession?.id).toMatch(/^LOCAL-TERMINAL 01-/);
    expect(st.posSessionOpenFailed).toBe(false); // verrou levé
    expect(st.sessionReopenError?.status).toBe(500); // trace conservée
  });

  it('mode test mais 401 (pas 5xx) : PAS de session locale — on expose le 401', async () => {
    setBypass(true);
    open.mockRejectedValue({ response: { status: 401 } });
    active.mockRejectedValue({ response: { status: 401 } });
    const ok = await usePOSStore.getState().reopenSessionWithFloat(1000);
    expect(ok).toBe(false);
    expect(usePOSStore.getState().posSession).toBeNull();
    expect(usePOSStore.getState().sessionReopenError?.status).toBe(401);
  });

  it('mode test hors périmètre (terminal non pilote) : pas de session locale', async () => {
    setBypass(true, '', 'TERMINAL 09');
    open.mockRejectedValue({ response: { status: 500 } });
    active.mockRejectedValue({ response: { status: 500 } });
    const ok = await usePOSStore.getState().reopenSessionWithFloat(1000);
    expect(ok).toBe(false);
    expect(usePOSStore.getState().posSession).toBeNull();
  });
});
