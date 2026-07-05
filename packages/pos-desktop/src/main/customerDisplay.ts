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
}

interface PersistedState {
  enabled: boolean;
  screenId: number | null;
  fullscreen: boolean;
  kiosk: boolean;
}

const DEFAULT_STATE: PersistedState = {
  enabled: true,
  screenId: null,
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

  /** The display the client window should target: explicit choice → else the
   *  first non-primary → else primary. */
  private targetDisplay(): Electron.Display {
    const all = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    if (this.state.screenId != null) {
      const chosen = all.find((d) => d.id === this.state.screenId);
      if (chosen) return chosen;
    }
    return all.find((d) => d.id !== primary.id) || primary;
  }

  // ── Window lifecycle ─────────────────────────────────────────

  /** Create the client window on the target display, if enabled. */
  open(): void {
    if (this.disposed) return;
    if (!this.state.enabled) return;
    if (this.window && !this.window.isDestroyed()) {
      this.moveToTargetDisplay();
      this.window.show();
      return;
    }

    const target = this.targetDisplay();
    const onSecondary = target.id !== screen.getPrimaryDisplay().id;

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
    const onSecondary = target.id !== screen.getPrimaryDisplay().id;
    this.window.setFullScreen(false);
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
    this.writeState();
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
    const target = this.targetDisplay();
    return {
      available: true,
      enabled: this.state.enabled,
      windowOpen: open,
      screenId: this.state.screenId,
      resolution: open ? `${target.size.width}x${target.size.height}` : null,
      fullscreen: this.state.fullscreen,
      kiosk: this.state.kiosk,
      displayCount: screen.getAllDisplays().length,
      displays: this.listDisplays(),
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

    // Re-evaluate placement when the physical display layout changes.
    screen.on('display-added', () => this.broadcastStatus());
    screen.on('display-removed', () => {
      // If the chosen screen vanished, fall back gracefully.
      if (this.state.screenId != null) {
        const stillThere = screen.getAllDisplays().some((d) => d.id === this.state.screenId);
        if (!stillThere && this.window && !this.window.isDestroyed()) this.moveToTargetDisplay();
      }
      this.broadcastStatus();
    });
  }
}
