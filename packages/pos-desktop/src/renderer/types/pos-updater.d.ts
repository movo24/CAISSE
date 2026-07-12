/**
 * Types du pont mise à jour automatique exposé par le preload Electron
 * (`window.posUpdater`). Absent en build web → toujours vérifier l'existence.
 */
export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'disabled';

export interface PosUpdateState {
  phase: UpdatePhase;
  currentVersion: string;
  availableVersion: string | null;
  channel: 'stable' | 'pilot';
  progressPercent: number;
  lastCheckedAt: string | null;
  lastError: string | null;
}

export interface PosUpdaterActivity {
  saleInProgress?: boolean;
  paymentInProgress?: boolean;
  printing?: boolean;
  syncing?: boolean;
}

export interface PosUpdaterBridge {
  getState: () => Promise<PosUpdateState>;
  check: () => Promise<PosUpdateState>;
  installNow: () => Promise<{ ok: boolean; reason?: string | null }>;
  setChannel: (channel: 'stable' | 'pilot') => Promise<PosUpdateState>;
  setActivity: (activity: PosUpdaterActivity) => void;
  onEvent: (cb: (state: PosUpdateState) => void) => () => void;
}

declare global {
  interface Window {
    posUpdater?: PosUpdaterBridge;
  }
}

export {};
