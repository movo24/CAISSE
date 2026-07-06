/**
 * Customer Display — native (Electron main) controller.
 *
 * Owns the physical second window: which display it lives on, open/close,
 * reload, fullscreen/kiosk, a crash watchdog that respawns it, and persistence
 * of the operator's choices across restarts. Content (cart, video, blackout,
 * identify) is driven separately by the renderer over BroadcastChannel — this
 * module only manages the WINDOW.
 *
 * Hard rule: the client window is fully decoupled from the POS window. If it
 * crashes, the watchdog respawns it; if respawning fails, the register is
 * untouched. Nothing here can block screen 1.
 */

import { app, BrowserWindow, screen, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import {
  selectClientDisplay,
  displaySignature,
  selectionStatus,
  type DisplayLike,
  type DisplaySignature,
  type SelectionReason,
} from './displaySelection';

/** Prefix for all controller logs so field diagnostics are greppable. */
const LOG = '[customer-display]';

/** Map an Electron display to the plain shape the pure selector understands. */
function toDisplayLike(d: Electron.Display): DisplayLike {
  return {
    id: d.id,
    bounds: d.bounds,
    size: d.size,
    scaleFactor: d.scaleFactor,
    rotation: d.rotation,
    internal: d.internal,
  };
}

export interface DisplayInfo {
  id: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  resolution: string;
  scaleFactor: number;
  isPrimary: boolean;
}

export interface NativeStatus {
  available: true;
  enabled: boolean;
  windowOpen: boolean;
  screenId: number | null;
  resolution: string | null;
  fullscreen: boolean;
  kiosk: boolean;
  displayCount: number;
  displays: DisplayInfo[];
  /** Why the current screen was chosen (id / signature / fallback). */
  selectionReason: SelectionReason;
  /** Dashboard status: connected / absent / wrong-screen / fallback. */
  screenStatus: 'connected' | 'absent' | 'wrong-screen' | 'fallback';
  /** True when the operator's chosen screen is no longer present. */
  requestedScreenMissing: boolean;
  /** userData directory (shown in the field diagnostic). */
  userDataPath: string;
}

interface PersistedState {
  enabled: boolean;
  screenId: number | null;
  /** Backup identity of the chosen screen — recovers it if Windows changes the id. */
  signature: DisplaySignature | null;
  fullscreen: boolean;
  kiosk: boolean;
}

const DEFAULT_STATE: PersistedState = {
  enabled: true,
  screenId: null,
  signature: null,
  fullscreen: true,
  kiosk: false,
};

export interface ControllerDeps {
  /** How the window should load the client-display route (dev vs packaged). */
  loadRoute: (win: BrowserWindow, route: string) => void;
  preloadPath: string;
  backgroundColor: string;
}

export class CustomerDisplayController {
  private window: BrowserWindow | null = null;
  private state: PersistedState;
  private intentionalClose = false;
  private respawnTimer: NodeJS.Timeout | null = null;
  private disposed = false;

  constructor(private readonly deps: ControllerDeps) {
    this.state = this.readState();
  }

  // ── Persistence ──────────────────────────────────────────────

  private stateFile(): string {
    return path.join(app.getPath('userData'), 'customer-display.json');
  }

  private readState(): PersistedState {
    try {
      const raw = fs.readFileSync(this.stateFile(), 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      return {
        enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_STATE.enabled,
        screenId: typeof parsed.screenId === 'number' ? parsed.screenId : null,
        signature:
          parsed.signature && typeof parsed.signature === 'object'
            ? (parsed.signature as DisplaySignature)
            : null,
        fullscreen: typeof parsed.fullscreen === 'boolean' ? parsed.fullscreen : DEFAULT_STATE.fullscreen,
        kiosk: typeof parsed.kiosk === 'boolean' ? parsed.kiosk : DEFAULT_STATE.kiosk,
      };
    } catch {
      return { ...DEFAULT_STATE };
    }
  }

  private writeState(): void {
    try {
      fs.writeFileSync(this.stateFile(), JSON.stringify(this.state), 'utf8');
    } catch {
      /* best-effort persistence */
    }
  }

  // ── Displays ─────────────────────────────────────────────────

  /** Last selection result, kept for status/diagnostics. */
  private lastReason: SelectionReason = 'none';
  private lastRequestedMissing = false;

  listDisplays(): DisplayInfo[] {
    const primary = screen.getPrimaryDisplay();
    return screen.getAllDisplays().map((d, idx) => ({
      id: d.id,
      label: d.id === primary.id ? `Écran ${idx + 1} (principal)` : `Écran ${idx + 1}`,
      bounds: d.bounds,
      resolution: `${d.size.width}x${d.size.height}`,
      scaleFactor: d.scaleFactor,
      isPrimary: d.id === primary.id,
    }));
  }

  /** Log every display's geometry — the single most useful field-diagnostic line. */
  private logDisplays(context: string): void {
    const primary = screen.getPrimaryDisplay();
    const all = screen.getAllDisplays();
    // eslint-disable-next-line no-console
    console.log(
      `${LOG} ${context}: ${all.length} display(s), primary=${primary.id}`,
      all.map((d) => ({
        id: d.id,
        primary: d.id === primary.id,
        bounds: d.bounds,
        workArea: d.workArea,
        size: d.size,
        scaleFactor: d.scaleFactor,
        rotation: d.rotation,
        internal: d.internal,
      })),
    );
  }

  /** Resolve which physical screen the client window targets (id → signature → fallback). */
  private resolveTarget() {
    const all = screen.getAllDisplays().map(toDisplayLike);
    const primaryId = screen.getPrimaryDisplay().id;
    const result = selectClientDisplay(all, primaryId, {
      screenId: this.state.screenId,
      signature: this.state.signature,
    });
    this.lastReason = result.reason;
    this.lastRequestedMissing = result.requestedScreenMissing;
    return result;
  }

  /** The Electron display the client window should target (null if none). */
  private targetDisplay(): Electron.Display | null {
    const chosenId = this.resolveTarget().display?.id;
    if (chosenId == null) return null;
    return screen.getAllDisplays().find((d) => d.id === chosenId) || null;
  }

  // ── Window lifecycle ─────────────────────────────────────────

  /** Create the client window on the target display, if enabled. */
  open(): void {
    if (this.disposed) return;
    if (!this.state.enabled) {
      // eslint-disable-next-line no-console
      console.log(`${LOG} open() skipped: disabled`);
      return;
    }
    if (this.window && !this.window.isDestroyed()) {
      this.moveToTargetDisplay();
      this.window.show();
      return;
    }

    this.logDisplays('open');
    const target = this.targetDisplay();
    if (!target) {
      // No display available at all — do NOT block; the register runs headless-of-client.
      // eslint-disable-next-line no-console
      console.warn(`${LOG} open() aborted: no display available`);
      this.broadcastStatus();
      return;
    }
    const onSecondary = target.id !== screen.getPrimaryDisplay().id;
    // eslint-disable-next-line no-console
    console.log(
      `${LOG} opening on display ${target.id} (${target.size.width}x${target.size.height}) reason=${this.lastReason} onPrimary=${!onSecondary}`,
    );

    this.intentionalClose = false;
    const win = new BrowserWindow({
      x: target.bounds.x,
      y: target.bounds.y,
      width: target.bounds.width || 1080,
      height: target.bounds.height || 1920,
      title: 'POS Caisse — Écran Client',
      backgroundColor: this.deps.backgroundColor,
      // Fullscreen/kiosk only make sense on a dedicated secondary screen.
      fullscreen: this.state.fullscreen && onSecondary,
      kiosk: this.state.kiosk && onSecondary,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: this.deps.preloadPath,
        backgroundThrottling: false, // keep video/animation smooth when unfocused
      },
    });

    this.window = win;
    this.deps.loadRoute(win, 'client-display');

    // ── Watchdog: respawn on crash, but not on an intentional close ──
    win.webContents.on('render-process-gone', () => this.scheduleRespawn());
    win.on('unresponsive', () => this.scheduleRespawn());
    win.on('closed', () => {
      this.window = null;
      if (!this.intentionalClose && this.state.enabled && !this.disposed) {
        this.scheduleRespawn();
      }
      this.broadcastStatus();
    });

    win.once('ready-to-show', () => this.broadcastStatus());
    this.broadcastStatus();
  }

  private scheduleRespawn(): void {
    if (this.disposed || !this.state.enabled) return;
    if (this.respawnTimer) return;
    this.respawnTimer = setTimeout(() => {
      this.respawnTimer = null;
      if (this.window && !this.window.isDestroyed()) {
        try {
          this.window.destroy();
        } catch {
          /* ignore */
        }
        this.window = null;
      }
      this.open();
    }, 1500);
  }

  close(): void {
    this.intentionalClose = true;
    if (this.respawnTimer) {
      clearTimeout(this.respawnTimer);
      this.respawnTimer = null;
    }
    if (this.window && !this.window.isDestroyed()) {
      this.window.close();
    }
    this.window = null;
  }

  reload(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.reload();
    } else {
      this.open();
    }
  }

  private moveToTargetDisplay(): void {
    if (!this.window || this.window.isDestroyed()) return;
    const target = this.targetDisplay();
    if (!target) return;
    const onSecondary = target.id !== screen.getPrimaryDisplay().id;
    // Fullscreen/kiosk are applied ONLY on a dedicated secondary screen — never
    // on the operator (primary) screen, so the cashier UI is never taken over.
    this.window.setFullScreen(false);
    this.window.setKiosk(false);
    this.window.setBounds(target.bounds);
    if (this.state.fullscreen && onSecondary) this.window.setFullScreen(true);
    this.window.setKiosk(this.state.kiosk && onSecondary);
  }

  // ── Settings mutations from the operator window ──────────────

  setEnabled(enabled: boolean): void {
    this.state.enabled = enabled;
    this.writeState();
    if (enabled) this.open();
    else this.close();
    this.broadcastStatus();
  }

  setScreen(screenId: number | null): void {
    this.state.screenId = screenId;
    // Capture a backup signature of the chosen screen so we can recover it if
    // Windows renumbers display ids after a reboot / re-plug.
    if (screenId != null) {
      const chosen = screen.getAllDisplays().find((d) => d.id === screenId);
      this.state.signature = chosen ? displaySignature(toDisplayLike(chosen)) : null;
    } else {
      this.state.signature = null;
    }
    this.writeState();
    // eslint-disable-next-line no-console
    console.log(`${LOG} setScreen(${screenId}) signature=`, this.state.signature);
    if (this.window && !this.window.isDestroyed()) this.moveToTargetDisplay();
    else this.open();
    this.broadcastStatus();
  }

  setFullscreen(fullscreen: boolean): void {
    this.state.fullscreen = fullscreen;
    this.writeState();
    if (this.window && !this.window.isDestroyed()) this.moveToTargetDisplay();
    this.broadcastStatus();
  }

  setKiosk(kiosk: boolean): void {
    this.state.kiosk = kiosk;
    this.writeState();
    if (this.window && !this.window.isDestroyed()) this.moveToTargetDisplay();
    this.broadcastStatus();
  }

  // ── Status ───────────────────────────────────────────────────

  getStatus(): NativeStatus {
    const open = !!this.window && !this.window.isDestroyed();
    const selection = this.resolveTarget();
    const target = selection.display;
    const screenStatus = selectionStatus(selection);
    return {
      available: true,
      enabled: this.state.enabled,
      windowOpen: open,
      screenId: this.state.screenId,
      resolution: target ? `${target.size.width}x${target.size.height}` : null,
      fullscreen: this.state.fullscreen,
      kiosk: this.state.kiosk,
      displayCount: screen.getAllDisplays().length,
      displays: this.listDisplays(),
      selectionReason: selection.reason,
      screenStatus,
      requestedScreenMissing: selection.requestedScreenMissing,
      userDataPath: app.getPath('userData'),
    };
  }

  /** Push status to the POS window(s) so the panel reflects live state. */
  private broadcastStatus(): void {
    const status = this.getStatus();
    for (const w of BrowserWindow.getAllWindows()) {
      if (w === this.window) continue;
      if (w.isDestroyed()) continue;
      try {
        w.webContents.send('customer-display:status', status);
      } catch {
        /* ignore */
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.close();
  }

  // ── IPC wiring ───────────────────────────────────────────────

  registerIpc(): void {
    ipcMain.handle('customer-display:getStatus', () => this.getStatus());
    ipcMain.handle('customer-display:listDisplays', () => this.listDisplays());
    ipcMain.handle('customer-display:open', () => {
      this.open();
      return this.getStatus();
    });
    ipcMain.handle('customer-display:close', () => {
      this.close();
      return this.getStatus();
    });
    ipcMain.handle('customer-display:reload', () => {
      this.reload();
      return this.getStatus();
    });
    ipcMain.handle('customer-display:setEnabled', (_e, enabled: boolean) => {
      this.setEnabled(!!enabled);
      return this.getStatus();
    });
    ipcMain.handle('customer-display:setScreen', (_e, screenId: number | null) => {
      this.setScreen(typeof screenId === 'number' ? screenId : null);
      return this.getStatus();
    });
    ipcMain.handle('customer-display:setFullscreen', (_e, fs2: boolean) => {
      this.setFullscreen(!!fs2);
      return this.getStatus();
    });
    ipcMain.handle('customer-display:setKiosk', (_e, k: boolean) => {
      this.setKiosk(!!k);
      return this.getStatus();
    });

    // Re-evaluate placement when the physical display layout changes (hot-plug).
    screen.on('display-added', () => this.onDisplayLayoutChanged('display-added'));
    screen.on('display-removed', () => this.onDisplayLayoutChanged('display-removed'));
    screen.on('display-metrics-changed', () => this.onDisplayLayoutChanged('display-metrics-changed'));
  }

  /**
   * A monitor was plugged, unplugged, or reconfigured. Re-resolve the target
   * and relocate the window if it is open. Never throws, never blocks the POS.
   */
  private onDisplayLayoutChanged(event: string): void {
    try {
      this.logDisplays(event);
      if (this.window && !this.window.isDestroyed()) {
        // Window still alive → move it onto the (possibly re-numbered) target.
        this.moveToTargetDisplay();
      } else if (this.state.enabled && !this.disposed) {
        // The client screen may have (re)appeared → (re)open on it.
        this.open();
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`${LOG} onDisplayLayoutChanged(${event}) error:`, err);
    } finally {
      this.broadcastStatus();
    }
  }
}
