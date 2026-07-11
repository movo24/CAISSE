import { describe, it, expect } from 'vitest';
import {
  isSafeToInstall,
  busyReason,
  normalizeChannel,
  electronUpdaterChannel,
  allowsPrerelease,
  checkIntervalMs,
  IDLE_ACTIVITY,
  MAX_CHECK_INTERVAL_MS,
  MIN_CHECK_INTERVAL_MS,
  DEFAULT_CHECK_INTERVAL_MS,
  type UpdateActivity,
} from './updatePolicy';

const busy = (over: Partial<UpdateActivity>): UpdateActivity => ({ ...IDLE_ACTIVITY, ...over });

describe('updatePolicy — isSafeToInstall', () => {
  it('idle → sûr', () => {
    expect(isSafeToInstall(IDLE_ACTIVITY)).toBe(true);
  });
  it('toute activité critique → non sûr', () => {
    expect(isSafeToInstall(busy({ saleInProgress: true }))).toBe(false);
    expect(isSafeToInstall(busy({ paymentInProgress: true }))).toBe(false);
    expect(isSafeToInstall(busy({ printing: true }))).toBe(false);
    expect(isSafeToInstall(busy({ syncing: true }))).toBe(false);
  });
});

describe('updatePolicy — busyReason (priorité paiement > impression > vente > sync)', () => {
  it('idle → null', () => {
    expect(busyReason(IDLE_ACTIVITY)).toBeNull();
  });
  it('paiement prime sur tout', () => {
    expect(busyReason(busy({ paymentInProgress: true, printing: true, saleInProgress: true }))).toBe('payment');
  });
  it('impression avant vente', () => {
    expect(busyReason(busy({ printing: true, saleInProgress: true }))).toBe('printing');
  });
  it('vente avant sync', () => {
    expect(busyReason(busy({ saleInProgress: true, syncing: true }))).toBe('sale');
  });
  it('sync seule', () => {
    expect(busyReason(busy({ syncing: true }))).toBe('syncing');
  });
});

describe('updatePolicy — canal', () => {
  it('normalise', () => {
    expect(normalizeChannel('pilot')).toBe('pilot');
    expect(normalizeChannel('stable')).toBe('stable');
    expect(normalizeChannel(undefined)).toBe('stable');
    expect(normalizeChannel('n_importe_quoi')).toBe('stable');
  });
  it('mappe vers electron-updater', () => {
    expect(electronUpdaterChannel('stable')).toBe('latest');
    expect(electronUpdaterChannel('pilot')).toBe('beta');
  });
  it('pré-release seulement en pilote', () => {
    expect(allowsPrerelease('pilot')).toBe(true);
    expect(allowsPrerelease('stable')).toBe(false);
  });
});

describe('updatePolicy — checkIntervalMs (≤ 24 h, ≥ 1 min)', () => {
  it('défaut 6 h si absent/invalide', () => {
    expect(checkIntervalMs()).toBe(DEFAULT_CHECK_INTERVAL_MS);
    expect(checkIntervalMs(NaN)).toBe(DEFAULT_CHECK_INTERVAL_MS);
    expect(checkIntervalMs(0)).toBe(DEFAULT_CHECK_INTERVAL_MS);
    expect(checkIntervalMs(-5)).toBe(DEFAULT_CHECK_INTERVAL_MS);
  });
  it('plafonne à 24 h (exigence « au minimum toutes les 24 h »)', () => {
    expect(checkIntervalMs(48 * 60 * 60 * 1000)).toBe(MAX_CHECK_INTERVAL_MS);
  });
  it('plancher à 1 min', () => {
    expect(checkIntervalMs(1000)).toBe(MIN_CHECK_INTERVAL_MS);
  });
  it('valeur intermédiaire conservée', () => {
    const twoHours = 2 * 60 * 60 * 1000;
    expect(checkIntervalMs(twoHours)).toBe(twoHours);
  });
});
