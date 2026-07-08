import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  cacheEmployeePin,
  verifyOfflinePin,
  clearOfflineAuthCache,
  OFFLINE_AUTH_TTL_MS,
  OFFLINE_AUTH_MAX_ATTEMPTS,
} from './offlineAuthCache';

const EMP = { id: 'emp-1', firstName: 'Alice', lastName: 'Martin', storeId: 'store-1', role: 'manager' };

/**
 * PR #28 — auth employé offline V1 (décision produit ratifiée) : cache local
 * uniquement après auth online réussie, hash salé (jamais de PIN en clair),
 * expiration stricte, anti-brute-force, rôle plafonné, titulaire uniquement,
 * traçable au retour online.
 */
describe('offlineAuthCache', () => {
  beforeEach(() => clearOfflineAuthCache());

  it('no cache → refused (an employee never authenticated online cannot unlock)', async () => {
    const r = await verifyOfflinePin('emp-1', '1234');
    expect(r).toEqual({ ok: false, reason: 'no_cache' });
  });

  it('cached after online auth → correct PIN unlocks; wrong PIN refused', async () => {
    await cacheEmployeePin(EMP, '1234');
    expect((await verifyOfflinePin('emp-1', '0000')).ok).toBe(false);
    const ok = await verifyOfflinePin('emp-1', '1234');
    expect(ok.ok).toBe(true);
  });

  it('the PIN is never stored in clear text (salted SHA-256 only)', async () => {
    await cacheEmployeePin(EMP, '9876');
    const raw = localStorage.getItem('caisse_offline_auth_v1') || '';
    expect(raw).not.toContain('9876');
    expect(raw).toMatch(/pinHash/);
    expect(raw).toMatch(/salt/);
  });

  it('offline role is CAPPED at cashier — no invented admin/manager rights', async () => {
    await cacheEmployeePin(EMP, '1234'); // real role: manager
    const r = await verifyOfflinePin('emp-1', '1234');
    expect(r.ok && r.employee.role).toBe('cashier');
    expect(r.ok && r.employee.cachedRole).toBe('manager'); // fact kept for the audit trail
  });

  it('strict expiration: past TTL the entry is dead and deleted', async () => {
    const t0 = 1_000_000;
    await cacheEmployeePin(EMP, '1234', t0);
    expect((await verifyOfflinePin('emp-1', '1234', t0 + OFFLINE_AUTH_TTL_MS - 1)).ok).toBe(true);
    const expired = await verifyOfflinePin('emp-1', '1234', t0 + OFFLINE_AUTH_TTL_MS + 1);
    expect(expired).toEqual({ ok: false, reason: 'expired' });
    // entry burned — even a later "valid" check finds nothing
    expect((await verifyOfflinePin('emp-1', '1234', t0)).ok).toBe(false);
  });

  it(`anti-brute-force: ${OFFLINE_AUTH_MAX_ATTEMPTS} wrong PINs burn the entry`, async () => {
    await cacheEmployeePin(EMP, '1234');
    for (let i = 0; i < OFFLINE_AUTH_MAX_ATTEMPTS - 1; i++) {
      expect((await verifyOfflinePin('emp-1', '0000')).ok).toBe(false);
    }
    const last = await verifyOfflinePin('emp-1', '0000');
    expect(last).toEqual({ ok: false, reason: 'burned' });
    // even the RIGHT pin is now refused — back online required
    expect((await verifyOfflinePin('emp-1', '1234')).ok).toBe(false);
  });

  it('a fresh online auth re-arms the cache (expiry + attempts reset)', async () => {
    await cacheEmployeePin(EMP, '1234');
    await verifyOfflinePin('emp-1', '0000'); // one failure
    await cacheEmployeePin(EMP, '1234');     // online again
    const r = await verifyOfflinePin('emp-1', '1234');
    expect(r.ok).toBe(true);
  });
});

describe('EmployeePinGate — offline wiring (source)', () => {
  const src = readFileSync(join(__dirname, '..', 'components', 'EmployeePinGate.tsx'), 'utf8');

  it('caches the PIN ONLY after a successful online auth', () => {
    expect(src).toMatch(/void cacheEmployeePin\(/);
    // the cache call sits in the success path (before requestLock(false)), not in the catch
    const catchIdx = src.indexOf('catch (err: any)');
    const cacheIdx = src.indexOf('void cacheEmployeePin(');
    expect(cacheIdx).toBeGreaterThan(-1);
    expect(cacheIdx).toBeLessThan(catchIdx);
  });

  it('offline fallback fires ONLY on network errors, never on a server 401/403', () => {
    expect(src).toMatch(/isNetworkError[\s\S]{0,300}verifyOfflinePin/);
  });

  it('offline unlock is holder-only (verifies the CURRENT employee id)', () => {
    expect(src).toMatch(/verifyOfflinePin\(employee\.id, pin\)/);
  });

  it('every offline unlock is queued durably for server-side audit on resync', () => {
    expect(src).toMatch(/type: 'offline_unlock_audit'[\s\S]{0,200}SESSION_UNLOCKED_OFFLINE/);
  });
});

describe('syncEngine — offline unlock audit lands server-side (source)', () => {
  const src = readFileSync(join(__dirname, 'syncEngine.ts'), 'utf8');
  it('has a sync case posting SESSION_UNLOCKED_OFFLINE via the score API', () => {
    expect(src).toMatch(/case 'offline_unlock_audit':[\s\S]{0,400}employeeScoreApi\.logEvent/);
  });
});
