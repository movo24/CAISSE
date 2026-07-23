import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Mock l'API AVANT d'importer le store (même patron que posSession.test.ts).
const { open, active, logout, logEvent } = vi.hoisted(() => ({
  open: vi.fn(),
  active: vi.fn(),
  logout: vi.fn().mockResolvedValue(undefined),
  logEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./api', () => ({
  authApi: { logout },
  posSessionApi: {
    open: (amount?: number) => Promise.resolve(open(amount)),
    close: () => Promise.resolve(undefined),
    active: () => Promise.resolve(active()),
    setOpeningCash: () => Promise.resolve(undefined),
  },
  employeeScoreApi: { logEvent: (d: unknown) => Promise.resolve(logEvent(d)) },
}));

import { usePOSStore } from '../stores/posStore';
import { shouldOfferReopen, initSessionReopenWatcher, disposeSessionReopenWatcher } from './sessionReopen';
import { useOfflineStore } from '../stores/offlineStore';

const emp = { id: 'emp-1', firstName: 'Karim', lastName: 'B.', role: 'cashier', storeId: 'store-1' };

beforeEach(() => {
  open.mockReset();
  active.mockReset();
  localStorage.clear();
  disposeSessionReopenWatcher();
  usePOSStore.setState({
    employee: emp as never,
    posSession: null,
    posSessionOpenFailed: true,
    sessionReopenOffered: false,
    openingCashRequired: false,
  });
});

describe('shouldOfferReopen — décision pure sur TRANSITION réseau', () => {
  it('offline→online avec caissier sans session → proposer', () => {
    expect(shouldOfferReopen({ prevStatus: 'offline', nextStatus: 'online', hasEmployee: true, hasSession: false })).toBe(true);
  });
  it('degraded→online → proposer', () => {
    expect(shouldOfferReopen({ prevStatus: 'degraded', nextStatus: 'online', hasEmployee: true, hasSession: false })).toBe(true);
  });
  it('online→online (pas une transition) → jamais (pas de boucle)', () => {
    expect(shouldOfferReopen({ prevStatus: 'online', nextStatus: 'online', hasEmployee: true, hasSession: false })).toBe(false);
  });
  it('session déjà active → PAS de prompt', () => {
    expect(shouldOfferReopen({ prevStatus: 'offline', nextStatus: 'online', hasEmployee: true, hasSession: true })).toBe(false);
  });
  it('aucun caissier connecté → pas de prompt', () => {
    expect(shouldOfferReopen({ prevStatus: 'offline', nextStatus: 'online', hasEmployee: false, hasSession: false })).toBe(false);
  });
});

describe('reopenSessionWithFloat — single-flight, 409 sans doublon, fond transmis', () => {
  it('le fond saisi part au serveur via open(openingCashMinorUnits) — attendu correct pour la suite', async () => {
    open.mockResolvedValue({ data: { id: 'sess-r1', openedAt: '2026-07-18T10:00:00Z', terminalId: 'T02', openingCashMinorUnits: 18750 } });
    const ok = await usePOSStore.getState().reopenSessionWithFloat(18750);
    expect(ok).toBe(true);
    expect(open).toHaveBeenCalledWith(18750);
    const st = usePOSStore.getState();
    expect(st.posSession?.id).toBe('sess-r1');
    expect(st.openingCashRequired).toBe(false); // fond déjà déclaré, pas de re-prompt
    expect(st.posSessionOpenFailed).toBe(false);
    expect(st.sessionReopenOffered).toBe(false);
  });

  it('single-flight : deux clics concurrents → UN seul open en vol', async () => {
    let release!: (v: { data: { id: string } }) => void;
    open.mockReturnValue(new Promise((r) => { release = r; }));
    const p1 = usePOSStore.getState().reopenSessionWithFloat(1000);
    const p2 = usePOSStore.getState().reopenSessionWithFloat(1000); // ignoré (verrou)
    release({ data: { id: 'sess-r2' } });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(open).toHaveBeenCalledTimes(1);
    expect(r1).toBe(true);
    expect(r2).toBe(false); // le second appel n'a rien ouvert
  });

  it('409 (session déjà active côté serveur) → ADOPTE l’existante, aucun doublon', async () => {
    open.mockRejectedValue({ response: { status: 409 } });
    active.mockResolvedValue({ data: { id: 'sess-exist', openedAt: '2026-07-18T08:00:00Z', terminalId: 'T02', openingCashMinorUnits: 5000 } });
    const ok = await usePOSStore.getState().reopenSessionWithFloat(9999);
    expect(ok).toBe(true);
    expect(usePOSStore.getState().posSession?.id).toBe('sess-exist');
    expect(open).toHaveBeenCalledTimes(1); // pas de re-tentative en boucle
  });

  it('session déjà adoptée localement → retourne true SANS appel réseau', async () => {
    usePOSStore.setState({ posSession: { id: 'sess-local', openedAt: 'x', terminalId: null } });
    const ok = await usePOSStore.getState().reopenSessionWithFloat(1000);
    expect(ok).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });

  it('échec total → false, le prompt reste à la main du caissier (pas de boucle)', async () => {
    open.mockRejectedValue(new Error('down'));
    active.mockRejectedValue(new Error('down'));
    usePOSStore.setState({ sessionReopenOffered: true });
    const ok = await usePOSStore.getState().reopenSessionWithFloat(1000);
    expect(ok).toBe(false);
    expect(usePOSStore.getState().sessionReopenOffered).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('watcher — accroché aux transitions du statut réseau, jamais une boucle', () => {
  it('transition vers online → prompt offert ; re-set online (sans transition) → rien de plus', () => {
    useOfflineStore.setState({ networkStatus: 'offline' } as never);
    initSessionReopenWatcher();
    useOfflineStore.setState({ networkStatus: 'online' } as never);
    expect(usePOSStore.getState().sessionReopenOffered).toBe(true);
    usePOSStore.getState().dismissSessionReopen();
    useOfflineStore.setState({ networkStatus: 'online' } as never); // pas une transition
    expect(usePOSStore.getState().sessionReopenOffered).toBe(false);
  });

  it('init idempotent : double init → un seul abonnement (un seul offre par transition)', () => {
    useOfflineStore.setState({ networkStatus: 'offline' } as never);
    initSessionReopenWatcher();
    initSessionReopenWatcher();
    useOfflineStore.setState({ networkStatus: 'online' } as never);
    expect(usePOSStore.getState().sessionReopenOffered).toBe(true);
  });
});

describe('garde-fous de source (patron printHonesty)', () => {
  const src = readFileSync(join(__dirname, '../components/pos/SessionReopenPrompt.tsx'), 'utf8');
  it('le prompt est NON BLOQUANT : pas de backdrop plein écran (les ventes continuent)', () => {
    expect(src).not.toMatch(/inset-0/);
    expect(src).toMatch(/fixed bottom-4 right-4/);
  });
  it('le message dit explicitement que les ventes passées restent hors comptage', () => {
    expect(src).toMatch(/resteront hors comptage/);
  });
});
