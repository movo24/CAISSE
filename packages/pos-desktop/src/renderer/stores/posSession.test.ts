import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Mock the api module BEFORE importing the store (hoisted-safe).
const { open, close, active, logout } = vi.hoisted(() => ({
  open: vi.fn(),
  close: vi.fn(),
  active: vi.fn(),
  logout: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/api', () => ({
  authApi: { logout },
  // Wrappers always return a promise so `.then/.catch` in the store are safe.
  posSessionApi: {
    open: () => Promise.resolve(open()),
    close: (id: string) => Promise.resolve(close(id)),
    active: () => Promise.resolve(active()),
  },
}));

import { usePOSStore } from './posStore';

describe('POS session lifecycle — une caisse appartient à un caissier', () => {
  beforeEach(() => {
    open.mockReset();
    close.mockReset();
    active.mockReset();
    localStorage.clear();
    usePOSStore.setState({ employee: null, accessToken: null, posSession: null });
  });

  const emp = { id: 'emp-1', firstName: 'Karim', lastName: 'B.', role: 'cashier', storeId: 'store-1' };

  it('opens a POS session on login', async () => {
    open.mockResolvedValue({ data: { id: 'sess-1', openedAt: '2026-07-07T09:04:00Z', terminalId: 'TERMINAL 02' } });
    usePOSStore.getState().setEmployee(emp as any, 'jwt');
    await new Promise((r) => setTimeout(r, 0)); // let the async open settle
    expect(open).toHaveBeenCalledTimes(1);
    const s = usePOSStore.getState().posSession;
    expect(s?.id).toBe('sess-1');
    expect(s?.openedAt).toBe('2026-07-07T09:04:00Z');
  });

  it('recovers the active session when open returns 409 (terminal already bound)', async () => {
    open.mockRejectedValue({ response: { status: 409 } });
    active.mockResolvedValue({ data: { id: 'sess-existing', openedAt: '2026-07-07T08:00:00Z', terminalId: 'TERMINAL 02' } });
    usePOSStore.getState().setEmployee(emp as any, 'jwt');
    await new Promise((r) => setTimeout(r, 0));
    expect(active).toHaveBeenCalled();
    expect(usePOSStore.getState().posSession?.id).toBe('sess-existing');
  });

  it('closes the POS session on logout and clears identity', () => {
    usePOSStore.setState({ employee: emp as any, accessToken: 'jwt', posSession: { id: 'sess-1', openedAt: 'x', terminalId: null } });
    usePOSStore.getState().logout();
    expect(close).toHaveBeenCalledWith('sess-1');
    expect(usePOSStore.getState().employee).toBeNull();
    expect(usePOSStore.getState().posSession).toBeNull();
  });
});

describe('ActiveCashierBanner — exigences UX (source)', () => {
  const src = readFileSync(join(__dirname, '..', 'components', 'ActiveCashierBanner.tsx'), 'utf8');

  it('affiche « Caisse de : » et le nom complet du caissier', () => {
    expect(src).toMatch(/Caisse de\s*:/i);
    expect(src).toContain('firstName');
    expect(src).toContain('lastName');
  });

  it('affiche l’état AUCUN CAISSIER CONNECTÉ + connexion obligatoire', () => {
    expect(src).toContain('AUCUN CAISSIER CONNECTÉ');
    expect(src).toMatch(/Connexion obligatoire pour encaisser/);
  });

  it('affiche session depuis + terminal + score jour', () => {
    expect(src).toMatch(/Session depuis/);
    expect(src).toMatch(/Score jour/);
    expect(src.toLowerCase()).toContain('terminal');
  });
});
