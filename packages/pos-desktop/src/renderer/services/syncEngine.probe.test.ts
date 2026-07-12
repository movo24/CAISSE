import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { probeNetworkStatus } from './syncEngine';
import { useOfflineStore } from '../stores/offlineStore';

/* W12 — sonde réseau tri-état : distinguer « pas d'internet » (offline) de
   « internet OK mais backend injoignable » (degraded). */

describe('probeNetworkStatus — tri-état online/offline/degraded', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("navigator hors ligne → 'offline' (sans appel réseau)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('navigator', { onLine: false });
    vi.stubGlobal('fetch', fetchSpy);
    expect(await probeNetworkStatus()).toBe('offline');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("internet OK + health 200 → 'online'", async () => {
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    expect(await probeNetworkStatus()).toBe('online');
  });

  it("internet OK + health non-2xx (ex. 503) → 'degraded'", async () => {
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    expect(await probeNetworkStatus()).toBe('degraded');
  });

  it("internet OK + fetch qui échoue (backend down / DNS) → 'degraded'", async () => {
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await probeNetworkStatus()).toBe('degraded');
  });
});

describe("offlineStore.goDegraded — comportement identique à l'offline, libellé distinct", () => {
  const s = () => useOfflineStore.getState();

  beforeEach(() => {
    localStorage.clear();
    useOfflineStore.setState({
      networkStatus: 'online',
      offlineSince: null,
      lastOfflineAt: null,
      queue: [],
      pendingCount: 0,
    });
  });

  it("pose networkStatus='degraded' + offlineSince, et journalise backend_unreachable", () => {
    s().goDegraded();
    expect(s().networkStatus).toBe('degraded');
    expect(s().offlineSince).not.toBeNull();
    const logs = s().queue.filter(
      (e) => e.type === 'antifraude_log' && e.payload?.event === 'backend_unreachable',
    );
    expect(logs).toHaveLength(1);
  });

  it("transition offline → degraded : conserve offlineSince, pas de double journal", () => {
    s().goOffline();
    const since = s().offlineSince;
    expect(since).not.toBeNull();
    s().goDegraded();
    expect(s().networkStatus).toBe('degraded');
    expect(s().offlineSince).toBe(since);
    const degradedLogs = s().queue.filter(
      (e) => e.type === 'antifraude_log' && e.payload?.event === 'backend_unreachable',
    );
    expect(degradedLogs).toHaveLength(0); // coupure déjà journalisée par goOffline
  });

  it('degraded répété : aucun nouveau journal (transition uniquement)', () => {
    s().goDegraded();
    s().goDegraded();
    const logs = s().queue.filter(
      (e) => e.type === 'antifraude_log' && e.payload?.event === 'backend_unreachable',
    );
    expect(logs).toHaveLength(1);
  });

  it('une entrée enfilée en degraded est marquée createdOffline', () => {
    s().goDegraded();
    const id = s().enqueue({
      type: 'ticket',
      payload: { ticketNumber: 'T-TEST' },
      cashierId: 'c1',
      cashierName: 'Caissier',
      storeId: 'store-1',
    });
    const entry = s().queue.find((e) => e.id === id);
    expect(entry?.createdOffline).toBe(true);
  });

  it('retour online après degraded : goOnline nettoie offlineSince', () => {
    s().goDegraded();
    s().goOnline();
    expect(s().networkStatus).toBe('online');
    expect(s().offlineSince).toBeNull();
  });
});
