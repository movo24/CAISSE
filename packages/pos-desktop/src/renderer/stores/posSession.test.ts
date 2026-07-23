import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Mock the api module BEFORE importing the store (hoisted-safe).
const { open, close, active, setOpeningCash, logout, logEvent } = vi.hoisted(() => ({
  open: vi.fn(),
  close: vi.fn(),
  active: vi.fn(),
  setOpeningCash: vi.fn().mockResolvedValue(undefined),
  logout: vi.fn().mockResolvedValue(undefined),
  logEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/api', () => ({
  authApi: { logout },
  // Wrappers always return a promise so `.then/.catch` in the store are safe.
  posSessionApi: {
    open: () => Promise.resolve(open()),
    close: (id: string, counted?: number) => Promise.resolve(close(id, counted)),
    active: () => Promise.resolve(active()),
    setOpeningCash: (id: string, amount: number) => Promise.resolve(setOpeningCash(id, amount)),
  },
  employeeScoreApi: { logEvent: (d: any) => Promise.resolve(logEvent(d)) },
}));

import { usePOSStore } from './posStore';

describe('POS session lifecycle — une caisse appartient à un caissier', () => {
  beforeEach(() => {
    open.mockReset();
    close.mockReset();
    active.mockReset();
    setOpeningCash.mockReset().mockResolvedValue(undefined);
    logEvent.mockReset();
    localStorage.clear();
    usePOSStore.setState({ employee: null, accessToken: null, posSession: null, openingCashRequired: false });
  });

  const emp = { id: 'emp-1', firstName: 'Karim', lastName: 'B.', role: 'cashier', storeId: 'store-1' };
  const emp2 = { id: 'emp-2', firstName: 'Sofia', lastName: 'M.', role: 'cashier', storeId: 'store-1' };

  it('opens a POS session on login', async () => {
    open.mockResolvedValue({ data: { id: 'sess-1', openedAt: '2026-07-07T09:04:00Z', terminalId: 'TERMINAL 02' } });
    usePOSStore.getState().setEmployee(emp as any, 'jwt');
    await new Promise((r) => setTimeout(r, 0)); // let the async open settle
    expect(open).toHaveBeenCalledTimes(1);
    const s = usePOSStore.getState().posSession;
    expect(s?.id).toBe('sess-1');
    expect(s?.openedAt).toBe('2026-07-07T09:04:00Z');
  });

  it('échec TOTAL (open + active) → posSessionOpenFailed=true, jamais silencieux', async () => {
    open.mockRejectedValue(new Error('network down'));
    active.mockRejectedValue(new Error('network down'));
    usePOSStore.getState().setEmployee(emp as any, 'jwt');
    await new Promise((r) => setTimeout(r, 0));
    expect(usePOSStore.getState().posSession).toBeNull();
    expect(usePOSStore.getState().posSessionOpenFailed).toBe(true);
  });

  it('le flag échec retombe à false dès qu\'une ouverture réussit ensuite', async () => {
    open.mockRejectedValueOnce(new Error('down'));
    active.mockRejectedValueOnce(new Error('down'));
    usePOSStore.getState().setEmployee(emp as any, 'jwt');
    await new Promise((r) => setTimeout(r, 0));
    expect(usePOSStore.getState().posSessionOpenFailed).toBe(true);

    open.mockResolvedValue({ data: { id: 'sess-2', openedAt: '2026-07-18T09:00:00Z', terminalId: 'TERMINAL 02' } });
    await usePOSStore.getState().openPosSession();
    expect(usePOSStore.getState().posSession?.id).toBe('sess-2');
    expect(usePOSStore.getState().posSessionOpenFailed).toBe(false);
  });

  it('réponse open sans id → état échec visible (pas de session fantôme)', async () => {
    open.mockResolvedValue({ data: {} });
    usePOSStore.getState().setEmployee(emp as any, 'jwt');
    await new Promise((r) => setTimeout(r, 0));
    expect(usePOSStore.getState().posSession).toBeNull();
    expect(usePOSStore.getState().posSessionOpenFailed).toBe(true);
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
    expect(close).toHaveBeenCalledWith('sess-1', undefined);
    expect(usePOSStore.getState().employee).toBeNull();
    expect(usePOSStore.getState().posSession).toBeNull();
  });

  it('logout forwards the counted cash to the close call (attendu resté serveur)', () => {
    usePOSStore.setState({ employee: emp as any, accessToken: 'jwt', posSession: { id: 'sess-1', openedAt: 'x', terminalId: null } });
    usePOSStore.getState().logout(15240); // 152,40 € comptés
    expect(close).toHaveBeenCalledWith('sess-1', 15240);
  });

  it('switchEmployee closes the old session, opens a new one, logs EMPLOYEE_SWITCHED (no silent switch)', async () => {
    open.mockResolvedValue({ data: { id: 'sess-2', openedAt: '2026-07-07T10:00:00Z', terminalId: 'TERMINAL 02' } });
    usePOSStore.setState({ employee: emp as any, accessToken: 'jwt', posSession: { id: 'sess-1', openedAt: 'x', terminalId: null } });

    await usePOSStore.getState().switchEmployee(emp2 as any, 'jwt2');

    expect(close).toHaveBeenCalledWith('sess-1', undefined); // ancienne session fermée
    expect(open).toHaveBeenCalled();                         // nouvelle session ouverte
    expect(usePOSStore.getState().employee?.id).toBe('emp-2'); // identité basculée
    expect(usePOSStore.getState().posSession?.id).toBe('sess-2');
    expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'EMPLOYEE_SWITCHED' }));
  });

  it('requests the opening-cash entry when a fresh session has no float', async () => {
    open.mockResolvedValue({ data: { id: 'sess-1', openedAt: 'x', terminalId: 'TERMINAL 02', openingCashMinorUnits: null } });
    usePOSStore.getState().setEmployee(emp as any, 'jwt');
    await new Promise((r) => setTimeout(r, 0));
    expect(usePOSStore.getState().openingCashRequired).toBe(true);
  });

  it('does NOT request opening cash when the recovered session already has a float', async () => {
    open.mockRejectedValue({ response: { status: 409 } });
    active.mockResolvedValue({ data: { id: 'sess-x', openedAt: 'x', terminalId: 'T', openingCashMinorUnits: 5000 } });
    usePOSStore.getState().setEmployee(emp as any, 'jwt');
    await new Promise((r) => setTimeout(r, 0));
    expect(usePOSStore.getState().openingCashRequired).toBe(false);
  });

  it('declareOpeningCash sends the float and clears the prompt', async () => {
    usePOSStore.setState({ posSession: { id: 'sess-1', openedAt: 'x', terminalId: null }, openingCashRequired: true });
    await usePOSStore.getState().declareOpeningCash(15000);
    expect(setOpeningCash).toHaveBeenCalledWith('sess-1', 15000);
    expect(usePOSStore.getState().openingCashRequired).toBe(false);
  });

  it('dismissOpeningCash clears the prompt without sending (float unknown)', () => {
    usePOSStore.setState({ posSession: { id: 'sess-1', openedAt: 'x', terminalId: null }, openingCashRequired: true });
    usePOSStore.getState().dismissOpeningCash();
    expect(setOpeningCash).not.toHaveBeenCalled();
    expect(usePOSStore.getState().openingCashRequired).toBe(false);
  });

  it('logScoreEvent signs the event with the current session id', () => {
    usePOSStore.setState({ employee: emp as any, posSession: { id: 'sess-9', openedAt: 'x', terminalId: null } });
    usePOSStore.getState().logScoreEvent('SESSION_LOCKED', 'test');
    expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'SESSION_LOCKED', sessionId: 'sess-9' }));
  });
});

describe('ActiveCashierBanner — exigences UX (source)', () => {
  const src = readFileSync(join(__dirname, '..', 'components', 'ActiveCashierBanner.tsx'), 'utf8');

  // Refonte premium (owner) : la présentation change, les INVARIANTS restent —
  // opérateur identifié (nom complet dominant), terminal, magasin, n° de
  // session + heure d'ouverture, score jour, état bloquant sans caissier.
  it('affiche le nom complet du caissier (opérateur dominant)', () => {
    expect(src).toContain('firstName');
    expect(src).toContain('lastName');
    expect(src).toMatch(/Opérateur — niveau 1/);
  });

  it('affiche l’état AUCUN CAISSIER CONNECTÉ + connexion obligatoire', () => {
    expect(src).toContain('AUCUN CAISSIER CONNECTÉ');
    expect(src).toMatch(/Connexion obligatoire pour encaisser/);
  });

  it('affiche n° de session + heure d’ouverture + terminal + magasin + score', () => {
    expect(src).toMatch(/Session \{sessionNo\}/);
    expect(src).toMatch(/depuis \{hhmm\(posSession\.openedAt\)\}/);
    expect(src).toContain('storeName');
    expect(src).toMatch(/score/i);
    expect(src.toLowerCase()).toContain('terminal');
  });
});
