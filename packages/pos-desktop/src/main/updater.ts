/**
 * Auto-update controller (electron-updater + GitHub Releases).
 *
 * Objectifs (cahier des charges terrain) :
 *  - vérifie au démarrage puis périodiquement (≤ 24 h) ;
 *  - télécharge en arrière-plan, vérifie l'intégrité (sha512 du latest.yml,
 *    fait par electron-updater), informe l'écran ;
 *  - N'INSTALLE JAMAIS pendant une vente / un paiement / une impression / une
 *    sync : l'installation se fait à la fermeture (`autoInstallOnAppQuit`) ou
 *    sur action explicite, gardée par la policy pure ;
 *  - en cas d'échec, la version installée continue de tourner (jamais throw) ;
 *  - une caisse ne devient jamais inutilisable si GitHub/Internet est indispo ;
 *  - canaux `stable` / `pilot` (pré-releases) ; version visible dans l'app ;
 *  - journalisation dans `userData/updates.log`.
 *
 * Toute la logique de DÉCISION vit dans `updatePolicy.ts` (testée). Ce module
 * ne fait qu'appliquer ces décisions à electron-updater.
 */
import { app, ipcMain, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { autoUpdater } from 'electron-updater';
import {
  isSafeToInstall,
  busyReason,
  normalizeChannel,
  electronUpdaterChannel,
  allowsPrerelease,
  checkIntervalMs,
  STARTUP_CHECK_DELAY_MS,
  IDLE_ACTIVITY,
  type UpdateActivity,
  type UpdateChannel,
} from './updatePolicy';

type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'disabled';

interface UpdateState {
  phase: UpdatePhase;
  currentVersion: string;
  availableVersion: string | null;
  channel: UpdateChannel;
  progressPercent: number;
  lastCheckedAt: string | null;
  lastError: string | null;
}

const CONFIG_FILE = 'update-config.json';
const LOG_FILE = 'updates.log';

export class UpdateController {
  private state: UpdateState;
  private activity: UpdateActivity = { ...IDLE_ACTIVITY };
  private timer: NodeJS.Timeout | null = null;
  private started = false;

  constructor() {
    this.state = {
      phase: app.isPackaged ? 'idle' : 'disabled',
      currentVersion: app.getVersion(),
      availableVersion: null,
      channel: this.readChannel(),
      progressPercent: 0,
      lastCheckedAt: null,
      lastError: null,
    };
  }

  // ── Config persistée (canal) ────────────────────────────────────────
  private configPath(): string {
    return path.join(app.getPath('userData'), CONFIG_FILE);
  }
  private readChannel(): UpdateChannel {
    try {
      const raw = fs.readFileSync(this.configPath(), 'utf-8');
      return normalizeChannel(JSON.parse(raw)?.channel);
    } catch {
      return 'stable';
    }
  }
  private writeChannel(channel: UpdateChannel): void {
    try {
      fs.writeFileSync(this.configPath(), JSON.stringify({ channel }), 'utf-8');
    } catch (e) {
      this.log(`writeChannel failed: ${String(e)}`);
    }
  }

  // ── Journalisation (fichier + console) ──────────────────────────────
  private log(msg: string): void {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    try {
      fs.appendFileSync(path.join(app.getPath('userData'), LOG_FILE), line);
    } catch {
      /* le log ne doit jamais casser l'app */
    }
    // eslint-disable-next-line no-console
    console.log('[updater]', msg);
  }

  private emit(): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('pos-update:event', this.state);
    }
  }
  private setPhase(phase: UpdatePhase, patch: Partial<UpdateState> = {}): void {
    this.state = { ...this.state, phase, ...patch };
    this.emit();
  }

  /** Démarre le contrôleur : IPC + configuration electron-updater + planification. */
  start(): void {
    this.registerIpc();
    if (!app.isPackaged) {
      this.log('dev/non-packagé — auto-update désactivé');
      return; // electron-updater ne fonctionne qu'en build packagé
    }
    if (this.started) return;
    this.started = true;

    autoUpdater.autoDownload = true; // télécharge en arrière-plan dès qu'une MAJ existe
    autoUpdater.autoInstallOnAppQuit = true; // installe à la fermeture → jamais en pleine vente
    autoUpdater.allowDowngrade = false;
    autoUpdater.channel = electronUpdaterChannel(this.state.channel);
    autoUpdater.allowPrerelease = allowsPrerelease(this.state.channel);
    autoUpdater.logger = {
      info: (m: unknown) => this.log(`info: ${String(m)}`),
      warn: (m: unknown) => this.log(`warn: ${String(m)}`),
      error: (m: unknown) => this.log(`error: ${String(m)}`),
      debug: () => {},
    } as never;

    autoUpdater.on('checking-for-update', () => this.setPhase('checking', { lastCheckedAt: new Date().toISOString() }));
    autoUpdater.on('update-available', (info) => {
      this.log(`update-available ${info?.version}`);
      this.setPhase('available', { availableVersion: info?.version ?? null });
    });
    autoUpdater.on('update-not-available', () => this.setPhase('not-available', { availableVersion: null }));
    autoUpdater.on('download-progress', (p) => this.setPhase('downloading', { progressPercent: Math.round(p?.percent ?? 0) }));
    autoUpdater.on('update-downloaded', (info) => {
      this.log(`update-downloaded ${info?.version} — sera installé à la fermeture (ou sur demande si caisse au repos)`);
      this.setPhase('downloaded', { availableVersion: info?.version ?? null, progressPercent: 100 });
    });
    autoUpdater.on('error', (err) => {
      // JAMAIS bloquant : on log, on reste sur la version courante.
      this.log(`error: ${err?.message || String(err)}`);
      this.setPhase('error', { lastError: err?.message || String(err) });
    });

    // 1ʳᵉ vérification différée (laisser booter le POS), puis périodique ≤ 24 h.
    setTimeout(() => this.check('startup'), STARTUP_CHECK_DELAY_MS);
    this.timer = setInterval(() => this.check('periodic'), checkIntervalMs());
    this.log(`auto-update actif — canal=${this.state.channel} v=${this.state.currentVersion}`);
  }

  /** Vérifie une MAJ. Ne throw jamais (réseau/GitHub indispo → simple log). */
  private async check(origin: string): Promise<void> {
    if (!app.isPackaged) return;
    try {
      this.log(`checkForUpdates (${origin})`);
      await autoUpdater.checkForUpdates();
    } catch (e) {
      this.log(`check(${origin}) échec réseau/repo (non bloquant): ${String(e)}`);
      this.setPhase('error', { lastError: String(e) });
    }
  }

  private registerIpc(): void {
    ipcMain.handle('pos-update:getState', () => this.state);
    ipcMain.handle('pos-update:check', async () => {
      await this.check('manual');
      return this.state;
    });
    ipcMain.handle('pos-update:installNow', () => {
      if (this.state.phase !== 'downloaded') {
        return { ok: false, reason: 'no-update' };
      }
      if (!isSafeToInstall(this.activity)) {
        return { ok: false, reason: busyReason(this.activity) };
      }
      this.log('installNow — quitAndInstall silencieux (caisse au repos)');
      // isSilent=true : installe sans assistant NSIS (aucun clic employé).
      // isForceRunAfter=true : relance le POS automatiquement après install.
      setImmediate(() => autoUpdater.quitAndInstall(true, true));
      return { ok: true };
    });
    ipcMain.handle('pos-update:setChannel', (_e, raw) => {
      const channel = normalizeChannel(raw);
      this.state.channel = channel;
      this.writeChannel(channel);
      if (app.isPackaged) {
        autoUpdater.channel = electronUpdaterChannel(channel);
        autoUpdater.allowPrerelease = allowsPrerelease(channel);
      }
      this.log(`canal → ${channel}`);
      this.emit();
      return this.state;
    });
    // Le renderer pousse l'état d'activité (vente/paiement/impression/sync).
    ipcMain.on('pos-update:setActivity', (_e, activity: Partial<UpdateActivity>) => {
      this.activity = { ...IDLE_ACTIVITY, ...(activity || {}) };
    });
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
