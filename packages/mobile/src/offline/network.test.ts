import { describe, it, expect, afterEach, vi } from 'vitest';
import { checkOnline, subscribeNetwork } from './network';

// PAQUET 250 — mobile hardening: connectivity detection (navigator.onLine +
// backend health ping). node env → stub navigator/window/fetch.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('checkOnline', () => {
  it('short-circuits to false when navigator reports offline (no fetch)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('navigator', { onLine: false });
    vi.stubGlobal('fetch', fetchSpy);
    expect(await checkOnline()).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns true when the health ping responds ok', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    expect(await checkOnline()).toBe(true);
  });

  it('returns false when the health ping is not ok', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    expect(await checkOnline()).toBe(false);
  });

  it('returns false (never throws) when fetch rejects', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    expect(await checkOnline()).toBe(false);
  });
});

describe('subscribeNetwork', () => {
  it('reports online/offline on events and unsubscribes cleanly', () => {
    const handlers: Record<string, () => void> = {};
    const nav = { onLine: true };
    vi.stubGlobal('navigator', nav);
    vi.stubGlobal('window', {
      addEventListener: (evt: string, h: () => void) => void (handlers[evt] = h),
      removeEventListener: vi.fn(),
    });

    const seen: string[] = [];
    const unsub = subscribeNetwork((s) => seen.push(s));

    nav.onLine = false;
    handlers['offline']();
    nav.onLine = true;
    handlers['online']();
    expect(seen).toEqual(['offline', 'online']);

    unsub();
    expect((window.removeEventListener as any).mock.calls.length).toBe(2);
  });
});
