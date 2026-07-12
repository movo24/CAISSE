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
  decideClientPlacement,
  boundsOverlap,
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
  /** Set by the crash watchdog — the ONLY closes that may auto-respawn. */
  private crashed = false;
  /**
   * The operator closed the client window by hand (X button). No automatic
   * recreation until an explicit re-open (IPC open / setEnabled / setScreen)
   * or a NEW display is plugged in — never a silent comeback over the register.
   */
  private userClosed = false;

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

  // ── Window lifecycle ─────────────────────────────────────────

  /** Current placement decision (pure logic) — SECONDARY DISPLAY ONLY. */
  private placement() {
    const all = screen.getAllDisplays().map(toDisplayLike);
    const primaryId = screen.getPrimaryDisplay().id;
    const decision = decideClientPlacement(all, primaryId, {
      screenId: this.state.screenId,
      signature: this.state.signature,
    });
    this.lastReason = decision.selection.reason;
    this.lastRequestedMissing = decision.selection.requestedScreenMissing;
    return decision;
  }

  /**
   * Create the client window — ONLY on a really-detected secondary display.
   * On a single-screen machine the client window is never shown and the
   * register (primary display) is never covered.
   */
  open(): void {
    if (this.disposed) return;
    if (!this.state.enabled) {
      // eslint-disable-next-line no-console
      console.log(`${LOG} open() skipped: disabled`);
      return;
    }
    if (this.window && !this.window.isDestroyed()) {
      this.moveToTargetDisplay();
      return;
    }

    this.logDisplays('open');
    const decision = this.placement();
    if (!decision.show) {
      // Hard rule: no secondary display → NO client window. Never block or
      // cover the register; do not loop — a reopen only happens on an explicit
      // action or a display-added event.
      // eslint-disable-next-line no-console
      console.warn(`${LOG} open() refused: ${decision.log}`);
      this.broadcastStatus();
      return;
    }
    const target = decision.display;
    const primary = screen.getPrimaryDisplay();
    // eslint-disable-next-line no-console
    console.log(
      `${LOG} opening client window: primary=${primary.id} ${JSON.stringify(primary.bounds)} → secondary=${target.id} ${JSON.stringify(decision.bounds)} reason=${decision.reason}`,
    );

    this.intentionalClose = false;
    this.crashed = false;
    const win = new BrowserWindow({
      // Exact bounds of the detected secondary display — never hard-coded.
      x: decision.bounds.x,
      y: decision.bounds.y,
      width: decision.bounds.width,
      height: decision.bounds.height,
      title: 'POS Caisse — Écran Client',
      backgroundColor: this.deps.backgroundColor,
      // Never steal focus from the register: created hidden, shown inactive,
      // and not focusable at all (the client display is watch-only — content
      // is driven from the POS window over BroadcastChannel).
      show: false,
      focusable: false,
      fullscreen: this.state.fullscreen,
      kiosk: this.state.kiosk,
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

    // ── Watchdog: respawn ONLY on a crash — never after a manual close ──
    win.webContents.on('render-process-gone', () => {
      this.crashed = true;
      this.scheduleRespawn();
    });
    win.on('unresponsive', () => {
      this.crashed = true;
      this.scheduleRespawn();
    });
    win.on('closed', () => {
      this.window = null;
      if (this.crashed && this.state.enabled && !this.disposed) {
        // Crash path → the watchdog (already scheduled) re-opens; open()
        // re-checks that a secondary display still exists before showing.
      } else if (!this.intentionalClose && !this.disposed) {
        // Manual close (X) → respect it. No automatic comeback.
        this.userClosed = true;
        // eslint-disable-next-line no-console
        console.log(`${LOG} client window closed by user — will not auto-reopen`);
      }
      this.broadcastStatus();
    });

    win.once('ready-to-show', () => {
      // Final guard (defence in depth): if the window ended up overlapping the
      // primary (operator) display, do NOT show it.
      const w = this.window;
      if (!w || w.isDestroyed()) return;
      const bounds = w.getBounds();
      const prim = screen.getPrimaryDisplay();
      if (boundsOverlap(bounds, prim.bounds)) {
        // eslint-disable-next-line no-console
        console.warn(
          `${LOG} final guard: client window bounds ${JSON.stringify(bounds)} overlap primary ${JSON.stringify(prim.bounds)} — not showing`,
        );
        this.closeWindowOnly('overlaps primary after placement');
        return;
      }
      // Show WITHOUT focus — the register keeps the keyboard.
      w.showInactive();
      // eslint-disable-next-line no-console
      console.log(`${LOG} client window shown (inactive) at ${JSON.stringify(bounds)}`);
      this.broadcastStatus();
    });
    this.broadcastStatus();
  }

  /** Close the window without touching persisted state (system-initiated). */
  private closeWindowOnly(why: string): void {
    // eslint-disable-next-line no-console
    console.log(`${LOG} closing client window: ${why}`);
    this.intentionalClose = true;
    if (this.window && !this.window.isDestroyed()) {
      try {
        this.window.close();
      } catch {
        /* ignore */
      }
    }
    this.window = null;
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
    this.crashed = false;
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
    const decision = this.placement();
    if (!decision.show) {
      // The secondary display is gone (or the target now sits on the primary):
      // close the client window cleanly — NEVER relocate it over the register.
      this.closeWindowOnly(decision.log);
      return;
    }
    this.window.setFullScreen(false);
    this.window.setKiosk(false);
    this.window.setBounds(decision.bounds);
    if (this.state.fullscreen) this.window.setFullScreen(true);
    this.window.setKiosk(this.state.kiosk);
    // eslint-disable-next-line no-console
    console.log(
      `${LOG} client window placed on display ${decision.display.id} at ${JSON.stringify(this.window.getBounds())}`,
    );
  }

  // ── Settings mutations from the operator window ──────────────

  setEnabled(enabled: boolean): void {
    this.state.enabled = enabled;
    this.writeState();
    if (enabled) {
      this.userClosed = false; // explicit operator intent overrides a manual close
      this.open();
    } else {
      this.close();
    }
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
    this.userClosed = false; // explicit operator intent overrides a manual close
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
      this.userClosed = false; // explicit operator action
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
   * A monitor was plugged, unplugged, or reconfigured.
   * - Secondary unplugged → the open window is closed cleanly (never moved
   *   over the register).
   * - Secondary (re)plugged → the window is recreated/re-placed on it; a
   *   NEW display clears a previous manual close (the operator plugging the
   *   client screen back in clearly wants it).
   * Never throws, never blocks the POS.
   */
  private onDisplayLayoutChanged(event: string): void {
    try {
      this.logDisplays(event);
      if (event === 'display-added') this.userClosed = false;
      if (this.window && !this.window.isDestroyed()) {
        // Window alive → re-place it, or close it if no secondary remains.
        this.moveToTargetDisplay();
      } else if (this.state.enabled && !this.disposed && !this.userClosed) {
        // The client screen may have (re)appeared → (re)open on it. open()
        // re-checks that a real secondary display exists before showing.
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
