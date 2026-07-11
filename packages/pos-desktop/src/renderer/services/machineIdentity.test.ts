import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * La suite pos-desktop tourne en environnement `node` (pas de jsdom). On
 * fournit des stubs minimalistes de `window` + `localStorage` sur globalThis
 * pour exercer le service d'identité machine sans navigateur.
 */
function makeLocalStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
}

async function freshModule() {
  vi.resetModules();
  return import('./machineIdentity');
}

beforeEach(() => {
  (globalThis as any).localStorage = makeLocalStorage();
  (globalThis as any).window = {}; // pas d'electronAPI par défaut
});

describe('machineIdentity', () => {
  it('utilise le bridge Electron quand présent et met en cache (+localStorage)', async () => {
    const mod = await freshModule();
    (globalThis as any).window = { electronAPI: { getMachineId: vi.fn().mockResolvedValue('ELECTRON-UUID-1234') } };
    const id = await mod.resolveMachineId();
    expect(id).toBe('ELECTRON-UUID-1234');
    expect(localStorage.getItem('pos_machine_id')).toBe('ELECTRON-UUID-1234');
    expect(mod.currentMachineId()).toBe('ELECTRON-UUID-1234');
  });

  it('repli navigateur (pas d’Electron) : génère et persiste un id stable', async () => {
    const mod = await freshModule();
    const a = await mod.resolveMachineId();
    expect(a.length).toBeGreaterThanOrEqual(8);
    expect(localStorage.getItem('pos_machine_id')).toBe(a);
    const b = await mod.resolveMachineId();
    expect(b).toBe(a);
  });

  it('currentMachineId lit le localStorage si le cache mémoire est vide', async () => {
    localStorage.setItem('pos_machine_id', 'PERSISTED-9999');
    const mod = await freshModule();
    expect(mod.currentMachineId()).toBe('PERSISTED-9999');
  });

  it('currentMachineId renvoie "" quand rien n’est encore résolu', async () => {
    const mod = await freshModule();
    expect(mod.currentMachineId()).toBe('');
  });

  it('bridge qui échoue → repli navigateur, jamais d’exception', async () => {
    const mod = await freshModule();
    (globalThis as any).window = { electronAPI: { getMachineId: vi.fn().mockRejectedValue(new Error('ipc down')) } };
    const id = await mod.resolveMachineId();
    expect(id.length).toBeGreaterThanOrEqual(8);
  });
});
