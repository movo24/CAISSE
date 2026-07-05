/**
 * Customer Display — field diagnostics.
 *
 * Tracks what the operator window last published to the client screen, and
 * formats a short, copy-pasteable text report so a problem on-site can be
 * relayed verbatim. The report builder is pure (unit-testable); it never
 * invents peripheral state it cannot observe.
 */
import type { DisplaySnapshot } from './snapshot';
import { formatPrice } from './snapshot';

export interface PublishState {
  lastSnapshotAt: string | null;
  lastItemCount: number;
  lastTotalMinorUnits: number;
  lastStoreName: string | null;
  snapshotsPublished: number;
}

const state: PublishState = {
  lastSnapshotAt: null,
  lastItemCount: 0,
  lastTotalMinorUnits: 0,
  lastStoreName: null,
  snapshotsPublished: 0,
};

/** Called by the publisher every time a snapshot is broadcast. */
export function recordPublishedSnapshot(snapshot: DisplaySnapshot): void {
  state.lastSnapshotAt = snapshot.at;
  state.lastItemCount = snapshot.itemCount;
  state.lastTotalMinorUnits = snapshot.totalMinorUnits;
  state.lastStoreName = snapshot.storeName;
  state.snapshotsPublished += 1;
}

export function getPublishState(): PublishState {
  return { ...state };
}

/** Reset — used by tests. */
export function resetDiagnostics(): void {
  state.lastSnapshotAt = null;
  state.lastItemCount = 0;
  state.lastTotalMinorUnits = 0;
  state.lastStoreName = null;
  state.snapshotsPublished = 0;
}

export interface DiagnosticReportInput {
  appVersion: string;
  platform: string;
  mode: 'development' | 'production';
  isDesktop: boolean;
  userDataPath: string | null;
  storage: { indexedDb: boolean; localSettings: boolean };
  display: {
    count: number;
    primaryResolution: string | null;
    selectedResolution: string | null;
    scaleFactor: number | null;
    screenStatus: string | null;
    selectionReason: string | null;
    windowOpen: boolean | null;
  };
  sync: {
    channelActive: boolean;
    invalidPayloadCount: number;
    lastDisplayHelloAt: string | null;
    lastDisplayResolution: string | null;
  };
  publish: PublishState;
  settings: {
    enabled: boolean;
    blackout: boolean;
    mode: string;
    terminalId: string;
    hasVideo: boolean;
  };
  generatedAt: string;
}

/** Build a compact, human-readable text report (pure). */
export function buildDiagnosticReport(input: DiagnosticReportInput): string {
  const yn = (b: boolean) => (b ? 'oui' : 'non');
  const dash = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? '—' : String(v));
  const lines = [
    '=== DIAGNOSTIC ÉCRAN CLIENT — POS Caisse ===',
    `Généré : ${input.generatedAt}`,
    '',
    '[Système]',
    `  Plateforme        : ${dash(input.platform)}`,
    `  Version app       : ${dash(input.appVersion)}`,
    `  Mode              : ${input.mode}`,
    `  Desktop (Electron): ${yn(input.isDesktop)}`,
    `  userData          : ${dash(input.userDataPath)}`,
    `  IndexedDB         : ${yn(input.storage.indexedDb)}`,
    `  Réglages locaux   : ${yn(input.storage.localSettings)}`,
    '',
    '[Écrans]',
    `  Écrans détectés   : ${input.display.count}`,
    `  Écran principal   : ${dash(input.display.primaryResolution)}`,
    `  Écran client      : ${dash(input.display.selectedResolution)} (scale ${dash(input.display.scaleFactor)})`,
    `  Statut écran      : ${dash(input.display.screenStatus)} (${dash(input.display.selectionReason)})`,
    `  Fenêtre ouverte   : ${input.display.windowOpen === null ? '— (web)' : yn(input.display.windowOpen)}`,
    '',
    '[Sync écran client]',
    `  BroadcastChannel  : ${input.sync.channelActive ? 'actif' : 'inactif'}`,
    `  Payloads rejetés  : ${input.sync.invalidPayloadCount}`,
    `  Dernier snapshot  : ${dash(input.publish.lastSnapshotAt)}`,
    `  Contenu snapshot  : ${input.publish.lastItemCount} article(s) · ${formatPrice(input.publish.lastTotalMinorUnits)}`,
    `  Snapshots publiés : ${input.publish.snapshotsPublished}`,
    `  Dernier hello écran: ${dash(input.sync.lastDisplayHelloAt)} (${dash(input.sync.lastDisplayResolution)})`,
    '',
    '[Réglages écran client]',
    `  Activé            : ${yn(input.settings.enabled)}`,
    `  Écran noir        : ${yn(input.settings.blackout)}`,
    `  Mode              : ${dash(input.settings.mode)}`,
    `  Terminal          : ${dash(input.settings.terminalId)}`,
    `  Vidéo idle        : ${yn(input.settings.hasVideo)}`,
    '=== FIN DIAGNOSTIC ===',
  ];
  return lines.join('\n');
}
