import { describe, it, expect, beforeEach } from 'vitest';
import {
  normalizeSettings,
  normalizeTerminalId,
  terminalLabel,
  loadSettings,
  saveSettings,
  DEFAULT_CUSTOMER_DISPLAY_SETTINGS,
  CUSTOMER_DISPLAY_STORAGE_KEY,
} from './settings';

describe('customerDisplay settings — normalizeSettings', () => {
  it('returns defaults for null / garbage input', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_CUSTOMER_DISPLAY_SETTINGS);
    expect(normalizeSettings(42)).toEqual(DEFAULT_CUSTOMER_DISPLAY_SETTINGS);
    expect(normalizeSettings('x')).toEqual(DEFAULT_CUSTOMER_DISPLAY_SETTINGS);
  });

  it('rejects an unknown mode and falls back to default', () => {
    expect(normalizeSettings({ mode: 'hacker' }).mode).toBe('auto');
    expect(normalizeSettings({ mode: 'video_only' }).mode).toBe('video_only');
  });

  it('rejects an unknown qrType', () => {
    expect(normalizeSettings({ qrType: 'nope' }).qrType).toBe('instagram');
    expect(normalizeSettings({ qrType: 'loyalty' }).qrType).toBe('loyalty');
  });

  it('clamps timeouts into safe ranges', () => {
    expect(normalizeSettings({ idleTimeoutSeconds: 0 }).idleTimeoutSeconds).toBe(3);
    expect(normalizeSettings({ idleTimeoutSeconds: 9999 }).idleTimeoutSeconds).toBe(120);
    expect(normalizeSettings({ successTimeoutSeconds: 0 }).successTimeoutSeconds).toBe(2);
    expect(normalizeSettings({ successTimeoutSeconds: 999 }).successTimeoutSeconds).toBe(60);
    expect(normalizeSettings({ successTimeoutSeconds: 6 }).successTimeoutSeconds).toBe(6);
  });

  it('normalises orientation to portrait unless explicitly landscape', () => {
    expect(normalizeSettings({}).orientation).toBe('portrait');
    expect(normalizeSettings({ orientation: 'weird' }).orientation).toBe('portrait');
    expect(normalizeSettings({ orientation: 'landscape' }).orientation).toBe('landscape');
  });

  it('keeps non-empty slogans and drops empty ones, capping at 8', () => {
    const s = normalizeSettings({ slogans: ['  A ', '', '   ', 'B'] });
    expect(s.slogans).toEqual(['A', 'B']);
    const many = normalizeSettings({ slogans: Array.from({ length: 20 }, (_, i) => `s${i}`) });
    expect(many.slogans).toHaveLength(8);
  });

  it('falls back to default slogans when list becomes empty', () => {
    expect(normalizeSettings({ slogans: ['', '  '] }).slogans)
      .toEqual(DEFAULT_CUSTOMER_DISPLAY_SETTINGS.slogans);
  });

  it('coerces screenId to number or null', () => {
    expect(normalizeSettings({ screenId: '12345' }).screenId).toBe(12345);
    expect(normalizeSettings({ screenId: 'abc' }).screenId).toBeNull();
    expect(normalizeSettings({ screenId: null }).screenId).toBeNull();
  });

  it('preserves booleans and rejects non-booleans', () => {
    expect(normalizeSettings({ enabled: false }).enabled).toBe(false);
    expect(normalizeSettings({ enabled: 'yes' }).enabled).toBe(true); // default
    expect(normalizeSettings({ blackout: true }).blackout).toBe(true);
  });
});

describe('customerDisplay settings — terminal id', () => {
  it('normalises numeric and string forms to 2-digit', () => {
    expect(normalizeTerminalId(1)).toBe('01');
    expect(normalizeTerminalId('2')).toBe('02');
    expect(normalizeTerminalId('Terminal 3')).toBe('03');
    expect(normalizeTerminalId('012')).toBe('012');
    expect(normalizeTerminalId(undefined)).toBe('01');
  });

  it('builds a human label', () => {
    expect(terminalLabel('2')).toBe('TERMINAL 02');
    expect(terminalLabel('01')).toBe('TERMINAL 01');
  });
});

describe('customerDisplay settings — persistence', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips through localStorage', () => {
    const saved = saveSettings({ ...DEFAULT_CUSTOMER_DISPLAY_SETTINGS, terminalId: '7', enabled: false });
    expect(saved.terminalId).toBe('07');
    expect(saved.enabled).toBe(false);
    const loaded = loadSettings();
    expect(loaded.terminalId).toBe('07');
    expect(loaded.enabled).toBe(false);
  });

  it('returns normalized defaults when storage is empty', () => {
    expect(loadSettings()).toEqual(DEFAULT_CUSTOMER_DISPLAY_SETTINGS);
  });

  it('recovers from corrupted JSON without throwing', () => {
    localStorage.setItem(CUSTOMER_DISPLAY_STORAGE_KEY, '{not json');
    expect(() => loadSettings()).not.toThrow();
    expect(loadSettings().mode).toBe('auto');
  });
});
