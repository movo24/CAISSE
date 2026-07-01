import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getDeviceId } from './deviceId';

// PAQUET 250 — mobile hardening: stable device id used in the offline audit
// envelope (employeeId + storeId + deviceId). node env → stub localStorage/crypto.

const makeLocalStorage = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
};

describe('getDeviceId', () => {
  beforeEach(() => {
    (globalThis as any).localStorage = makeLocalStorage();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as any).localStorage;
  });

  it('generates a UUID via crypto.randomUUID and persists it', () => {
    vi.stubGlobal('crypto', { randomUUID: () => '11111111-1111-4111-8111-111111111111' });
    const id = getDeviceId();
    expect(id).toBe('11111111-1111-4111-8111-111111111111');
    expect(localStorage.getItem('caisse.deviceId')).toBe(id);
  });

  it('is stable across calls (returns the persisted id)', () => {
    vi.stubGlobal('crypto', { randomUUID: () => crypto.randomUUID?.() ?? 'x' });
    let n = 0;
    vi.stubGlobal('crypto', { randomUUID: () => `uuid-${++n}` });
    const first = getDeviceId();
    const second = getDeviceId();
    expect(first).toBe('uuid-1');
    expect(second).toBe('uuid-1'); // not regenerated
  });

  it('falls back to a dev- prefix when crypto.randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {}); // no randomUUID
    const id = getDeviceId();
    expect(id).toMatch(/^dev-\d+-[a-z0-9]+$/);
    expect(localStorage.getItem('caisse.deviceId')).toBe(id);
  });
});
