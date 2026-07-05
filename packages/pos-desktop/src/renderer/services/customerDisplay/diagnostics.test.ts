import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordPublishedSnapshot,
  getPublishState,
  resetDiagnostics,
  buildDiagnosticReport,
  type DiagnosticReportInput,
} from './diagnostics';
import { buildSnapshot } from './snapshot';

const branding = { storeName: "The Wesley's", terminalLabel: 'TERMINAL 01' };

describe('publish-state tracking', () => {
  beforeEach(() => resetDiagnostics());

  it('starts empty', () => {
    expect(getPublishState()).toEqual({
      lastSnapshotAt: null, lastItemCount: 0, lastTotalMinorUnits: 0, lastStoreName: null, snapshotsPublished: 0,
    });
  });

  it('records each published snapshot', () => {
    const snap = buildSnapshot(
      { items: [{ name: 'A', quantity: 2, unitPriceMinorUnits: 100, discountMinorUnits: 0 }], subtotalMinorUnits: 200, totalDiscountMinorUnits: 0, totalMinorUnits: 200, customer: null },
      branding, '2026-07-05T10:00:00.000Z',
    );
    recordPublishedSnapshot(snap);
    recordPublishedSnapshot(snap);
    const s = getPublishState();
    expect(s.snapshotsPublished).toBe(2);
    expect(s.lastItemCount).toBe(2);
    expect(s.lastTotalMinorUnits).toBe(200);
    expect(s.lastSnapshotAt).toBe('2026-07-05T10:00:00.000Z');
  });
});

describe('buildDiagnosticReport', () => {
  const input: DiagnosticReportInput = {
    appVersion: '0.1.0', platform: 'win32', mode: 'production', isDesktop: true,
    userDataPath: 'C:/Users/x/AppData/Roaming/POS Caisse',
    storage: { indexedDb: true, localSettings: true },
    display: { count: 2, primaryResolution: '1920x1080', selectedResolution: '1080x1920', scaleFactor: 1, screenStatus: 'connected', selectionReason: 'selected-id', windowOpen: true },
    sync: { channelActive: true, invalidPayloadCount: 0, lastDisplayHelloAt: '2026-07-05T10:00:00.000Z', lastDisplayResolution: '1080x1920' },
    publish: { lastSnapshotAt: '2026-07-05T10:00:00.000Z', lastItemCount: 3, lastTotalMinorUnits: 1987, lastStoreName: "The Wesley's", snapshotsPublished: 5 },
    settings: { enabled: true, blackout: false, mode: 'auto', terminalId: '01', hasVideo: true },
    generatedAt: '2026-07-05T10:01:00.000Z',
  };

  it('produces a text report containing the key facts', () => {
    const r = buildDiagnosticReport(input);
    expect(r).toContain('DIAGNOSTIC ÉCRAN CLIENT');
    expect(r).toContain('win32');
    expect(r).toContain('1080x1920');
    expect(r).toContain('connected');
    expect(r).toContain('Payloads rejetés  : 0');
    expect(r).toContain('3 article(s)');
    expect(r).toContain('Terminal          : 01');
    expect(r).toContain('FIN DIAGNOSTIC');
  });

  it('renders dashes for missing values and never throws', () => {
    const empty: DiagnosticReportInput = {
      ...input, userDataPath: null,
      display: { count: 0, primaryResolution: null, selectedResolution: null, scaleFactor: null, screenStatus: null, selectionReason: null, windowOpen: null },
      sync: { channelActive: false, invalidPayloadCount: 2, lastDisplayHelloAt: null, lastDisplayResolution: null },
    };
    const r = buildDiagnosticReport(empty);
    expect(r).toContain('userData          : —');
    expect(r).toContain('BroadcastChannel  : inactif');
    expect(r).toContain('Fenêtre ouverte   : — (web)');
  });
});
