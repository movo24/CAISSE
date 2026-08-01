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
    setOpeningCash: (id: string, amount: number) => Promise.resolve(setOpeningCash(id, amount)),
  },
  employeeScoreApi: { logEvent: (d: unknown) => Promise.resolve(logEvent(d)) },
  posTerminalId: () => 'TERMINAL 01',
}));

import { usePOSStore, describeSessionError, isServerDownError } from './posStore';

const emp = { id: 'emp-1', firstName: 'K', lastName: 'B', role: 'cashier', storeId: 'store-1' };

beforeEach(() => {
  open.mockReset();
  active.mockReset();
  setOpeningCash.mockReset().mockResolvedValue(undefined);
  localStorage.clear();
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
afterEach(() => localStorage.clear());

describe('describeSessionError / isServerDownError', () => {
  it('code HTTP réel + errorId, jamais générique', () => {
    const d = describeSessionError({ response: { status: 500, data: { message: 'boom' } } });
    expect(d.status).toBe(500);
    expect(d.message).toContain('HTTP 500');
    expect(d.errorId).toMatch(/^ERR-/);
  });
  it('5xx/timeout = serveur down ; 401/409/réseau = non', () => {
    expect(isServerDownError(describeSessionError({ response: { status: 500 } }))).toBe(true);
    expect(isServerDownError(describeSessionError({ code: 'ECONNABORTED' }))).toBe(true);
    expect(isServerDownError(describeSessionError({ response: { status: 401 } }))).toBe(false);
    expect(isServerDownError(describeSessionError({ response: { status: 409 } }))).toBe(false);
  });
});

describe('MODE SECOURS — bascule AUTOMATIQUE et INCONDITIONNELLE sur 5xx (aucune variable d\'env)', () => {
  it('/open 500 + /active 500 → session locale d\'urgence, verrou levé, fond saisi conservé', async () => {
    open.mockRejectedValue({ response: { status: 500 } });
    active.mockRejectedValue({ response: { status: 500 } });
    const ok = await usePOSStore.getState().reopenSessionWithFloat(18750);
    expect(ok).toBe(true);
    const st = usePOSStore.getState();
    expect(st.posSession?.provisional).toBe(true);
    expect(st.posSession?.id).toMatch(/^LOCAL-TERMINAL 01-/);
    expect(st.posSession?.openingCashMinorUnits).toBe(18750); // fond local
    expect(st.posSessionOpenFailed).toBe(false); // verrou levé
    expect(st.sessionReopenError?.status).toBe(500); // trace conservée
  });

  it('la session locale est PERSISTÉE (survie au redémarrage)', async () => {
    open.mockRejectedValue({ response: { status: 500 } });
    active.mockRejectedValue({ response: { status: 500 } });
    await usePOSStore.getState().reopenSessionWithFloat(18750);
    const raw = localStorage.getItem('pos_provisional_session');
    expect(raw).toBeTruthy();
    const persisted = JSON.parse(raw as string);
    expect(persisted.provisional).toBe(true);
    expect(persisted.openingCashMinorUnits).toBe(18750);
  });

  it('openPosSession (connexion) : /open 500 → session locale immédiate, fond à saisir', async () => {
    open.mockRejectedValue({ response: { status: 500 } });
    active.mockRejectedValue({ response: { status: 500 } });
    await usePOSStore.getState().openPosSession();
    const st = usePOSStore.getState();
    expect(st.posSession?.provisional).toBe(true);
    expect(st.posSessionOpenFailed).toBe(false);
    expect(st.openingCashRequired).toBe(true); // CashOpenModal demandera le fond
  });

  it('401 (pas 5xx) → PAS de session locale automatique, on expose le 401', async () => {
    open.mockRejectedValue({ response: { status: 401 } });
    active.mockRejectedValue({ response: { status: 401 } });
    const ok = await usePOSStore.getState().reopenSessionWithFloat(1000);
    expect(ok).toBe(false);
    expect(usePOSStore.getState().posSession).toBeNull();
    expect(usePOSStore.getState().sessionReopenError?.status).toBe(401);
  });

  it('retour serveur : /open réussit → la vraie session REMPLACE le secours (persistance effacée)', async () => {
    // 1) secours actif
    open.mockRejectedValueOnce({ response: { status: 500 } });
    active.mockRejectedValueOnce({ response: { status: 500 } });
    await usePOSStore.getState().reopenSessionWithFloat(18750);
    expect(localStorage.getItem('pos_provisional_session')).toBeTruthy();
    // 2) serveur revient
    usePOSStore.setState({ posSession: null });
    open.mockResolvedValue({ data: { id: 'sess-real', openedAt: 'x', terminalId: 'TERMINAL 01', openingCashMinorUnits: 18750 } });
    await usePOSStore.getState().openPosSession();
    expect(usePOSStore.getState().posSession?.id).toBe('sess-real');
    expect(usePOSStore.getState().posSession?.provisional).toBeUndefined();
    expect(localStorage.getItem('pos_provisional_session')).toBeNull(); // secours effacé
  });
});

describe('redémarrage du POS → session locale restaurée (jamais reverrouillée)', () => {
  it('un store fraîchement (ré)importé restaure la session locale persistée', async () => {
    // Simule un redémarrage : on persiste une session locale, puis on force la
    // ré-évaluation du module store (nouvelle instance = nouveau démarrage app).
    localStorage.setItem(
      'pos_provisional_session',
      JSON.stringify({ id: 'LOCAL-TERMINAL 01-ABC', openedAt: 'x', terminalId: 'TERMINAL 01', provisional: true, openingCashMinorUnits: 18750 }),
    );
    vi.resetModules();
    vi.doMock('../services/api', () => ({
      authApi: { logout },
      posSessionApi: { open: () => Promise.resolve(open()), close: () => Promise.resolve(undefined), active: () => Promise.resolve(active()), setOpeningCash: () => Promise.resolve(undefined) },
      employeeScoreApi: { logEvent: () => Promise.resolve(undefined) },
      posTerminalId: () => 'TERMINAL 01',
    }));
    const mod = await import('./posStore');
    const st = mod.usePOSStore.getState();
    expect(st.posSession?.provisional).toBe(true);
    expect(st.posSession?.id).toBe('LOCAL-TERMINAL 01-ABC');
    expect(st.posSession?.openingCashMinorUnits).toBe(18750);
  });
});

describe('forceLocalUnlock — bouton manager (contourne réellement le verrou serveur)', () => {
  it('ouvre une session locale INCONDITIONNELLEMENT avec le fond saisi', () => {
    usePOSStore.getState().forceLocalUnlock(18750);
    const st = usePOSStore.getState();
    expect(st.posSession?.provisional).toBe(true);
    expect(st.posSession?.openingCashMinorUnits).toBe(18750);
    expect(st.posSessionOpenFailed).toBe(false);
    expect(st.openingCashRequired).toBe(false);
    expect(localStorage.getItem('pos_provisional_session')).toBeTruthy();
  });
  it('sans fond → ouvre quand même et demande le fond', () => {
    usePOSStore.getState().forceLocalUnlock(null);
    expect(usePOSStore.getState().posSession?.provisional).toBe(true);
    expect(usePOSStore.getState().openingCashRequired).toBe(true);
  });
});

describe('storeInfo — persisté et restauré (ticket du mode secours identique au normal)', () => {
  const store = { storeName: 'The Wesley', siret: '12345678900011', tvaIntracom: 'FR00', receiptLogoUrl: 'data:x', receiptQrEnabled: true } as never;

  it('setStoreInfo persiste les infos magasin', () => {
    usePOSStore.getState().setStoreInfo(store);
    expect(localStorage.getItem('pos_store_info')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('pos_store_info') as string).storeName).toBe('The Wesley');
  });

  it('un store fraîchement (ré)importé restaure storeInfo (logo/magasin/TVA/QR au redémarrage)', async () => {
    localStorage.setItem('pos_store_info', JSON.stringify(store));
    vi.resetModules();
    vi.doMock('../services/api', () => ({
      authApi: { logout }, posSessionApi: { open: () => Promise.resolve(open()), close: () => Promise.resolve(undefined), active: () => Promise.resolve(active()), setOpeningCash: () => Promise.resolve(undefined) },
      employeeScoreApi: { logEvent: () => Promise.resolve(undefined) }, posTerminalId: () => 'TERMINAL 01',
    }));
    const mod = await import('./posStore');
    expect(mod.usePOSStore.getState().storeInfo?.storeName).toBe('The Wesley');
    expect(mod.usePOSStore.getState().storeInfo?.siret).toBe('12345678900011');
  });
});

describe('declareOpeningCash sur session locale — reste LOCAL (aucun appel serveur)', () => {
  it('enregistre le fond localement et le persiste, sans appeler setOpeningCash', async () => {
    usePOSStore.getState().forceLocalUnlock(null);
    await usePOSStore.getState().declareOpeningCash(18750);
    expect(setOpeningCash).not.toHaveBeenCalled(); // pas d'appel serveur (id LOCAL-…)
    expect(usePOSStore.getState().posSession?.openingCashMinorUnits).toBe(18750);
    expect(usePOSStore.getState().openingCashRequired).toBe(false);
    const persisted = JSON.parse(localStorage.getItem('pos_provisional_session') as string);
    expect(persisted.openingCashMinorUnits).toBe(18750);
  });
});
