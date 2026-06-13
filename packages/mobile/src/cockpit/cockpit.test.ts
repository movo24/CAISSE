/**
 * Cockpit (étage 5) — pure-logic tests: the role gate (UX — the guarantee stays
 * server-side), the display formatters (format only, never compute), the
 * quiet-hours client validation (mirror of the server rule), and the push-token
 * floor contract (null until FCM is wired).
 */
import { describe, it, expect } from 'vitest';
import { canAccessCockpit, COCKPIT_ROLES } from './access';
import { eurosFromMinor, pctLabel, freshnessLabel, validateQuietHours } from './format';
import { getPushToken, PUSH_PLATFORM } from './push-token';

describe('cockpit — role gate (UX only)', () => {
  it('opens for manager/admin/owner (case-insensitive)', () => {
    expect(canAccessCockpit('manager')).toBe(true);
    expect(canAccessCockpit('Admin')).toBe(true);
    expect(canAccessCockpit('OWNER')).toBe(true);
  });
  it('stays closed for cashier / unknown / missing role', () => {
    expect(canAccessCockpit('cashier')).toBe(false);
    expect(canAccessCockpit('supervisor')).toBe(false);
    expect(canAccessCockpit('')).toBe(false);
    expect(canAccessCockpit(null)).toBe(false);
    expect(canAccessCockpit(undefined)).toBe(false);
  });
  it('the gate list matches the backend org-wide + manager semantics', () => {
    expect(COCKPIT_ROLES).toEqual(['manager', 'admin', 'owner']);
  });
});

describe('cockpit — eurosFromMinor (display only)', () => {
  it('formats integer centimes in French', () => {
    expect(eurosFromMinor(150000)).toBe('1 500,00 €');
    expect(eurosFromMinor(123456)).toBe('1 234,56 €');
    expect(eurosFromMinor(5)).toBe('0,05 €');
    expect(eurosFromMinor(0)).toBe('0,00 €');
    expect(eurosFromMinor(-300)).toBe('-3,00 €');
  });
  it('null/undefined → em dash (honest absence, nothing fabricated)', () => {
    expect(eurosFromMinor(null)).toBe('—');
    expect(eurosFromMinor(undefined)).toBe('—');
  });
});

describe('cockpit — pctLabel', () => {
  it('renders server-computed percentages as-is, French comma', () => {
    expect(pctLabel(61.7)).toBe('61,7 %');
    expect(pctLabel(100)).toBe('100 %');
    expect(pctLabel(null)).toBe('—');
  });
});

describe('cockpit — freshnessLabel', () => {
  const now = new Date('2026-06-12T12:00:00Z');
  it('grades the age honestly', () => {
    expect(freshnessLabel('2026-06-12T11:59:40Z', now)).toBe('à l’instant');
    expect(freshnessLabel('2026-06-12T11:48:00Z', now)).toBe('il y a 12 min');
    expect(freshnessLabel('2026-06-12T09:00:00Z', now)).toBe('il y a 3 h');
    expect(freshnessLabel('2026-06-10T09:00:00Z', now)).toContain('le ');
  });
  it('missing/garbage → "fraîcheur inconnue" (never a fake freshness)', () => {
    expect(freshnessLabel(null, now)).toBe('fraîcheur inconnue');
    expect(freshnessLabel('not-a-date', now)).toBe('fraîcheur inconnue');
  });
});

describe('cockpit — validateQuietHours (mirror of the server rule)', () => {
  it('accepts a valid pair, a wrapped pair, and none', () => {
    expect(validateQuietHours(22, 7)).toBeNull();
    expect(validateQuietHours(9, 17)).toBeNull();
    expect(validateQuietHours(null, null)).toBeNull();
  });
  it('ADVERSE — rejects out-of-range, non-integer, and lone hours', () => {
    expect(validateQuietHours(25, 7)).not.toBeNull();
    expect(validateQuietHours(8.5, 17)).not.toBeNull();
    expect(validateQuietHours(22, null)).not.toBeNull();
    expect(validateQuietHours(null, 7)).not.toBeNull();
  });
});

describe('cockpit — push-token seam (FCM deferred)', () => {
  it('the floor returns null — registration stays disabled, alerts stay visible in-app', async () => {
    expect(await getPushToken()).toBeNull();
    expect(PUSH_PLATFORM).toBe('web');
  });
});
