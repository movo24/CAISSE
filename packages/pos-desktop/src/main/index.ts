/**
 * Electron Main Process — POS Caisse desktop.
 *
 * Production-grade wrapper around the EXISTING web front-end. No front-end
 * code is modified: in a packaged build we serve the Vite `dist/` output via a
 * custom `app://` protocol and route every unknown path back to index.html so
 * the app's BrowserRouter works under packaging (file:// would break it).
 *
 * Dev mode loads the Vite dev server. Production loads the bundled renderer.
 */

import { app, BrowserWindow, protocol, net, shell, ipcMain, screen } from 'electron';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { CustomerDisplayController } from './customerDisplay';
import { registerPosPrintingIpc } from './posPrinting';
import { UpdateController } from './updater';
import { registerPosRawPrintIpc } from './posRawPrint';
import { registerMachineIdIpc } from './machineId';

let posWindow: BrowserWindow | null = null;
let customerDisplay: CustomerDisplayController | null = null;
let updateController: UpdateController | null = null;

// Version de l'app (depuis package.json packagé) — lue synchroniquement par le
// preload pour l'afficher dans le POS. Toujours exacte, jamais 'dev' en build.
ipcMain.on('app:getVersion', (e) => {
  e.returnValue = app.getVersion();
});

const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';
const DEV_URL = process.env.POS_DEV_URL || 'http://localhost:5175';

/** Root of the bundled renderer (Vite `dist/`), inside the asar/app resources. */
const RENDERER_ROOT = path.join(__dirname, '..');
const APP_SCHEME = 'app';

// Custom scheme must be registered as privileged BEFORE app is ready so it
// behaves like https (secure context, fetch, service worker, etc.).
protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

/**
 * Serve files from the renderer root over app://. SPA fallback: any path
 * without a file extension (a client-side route) resolves to index.html.
 */
function registerAppProtocol(): void {
  protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname);
    // Strip leading slash; default + extensionless routes → index.html (SPA).
    const hasExt = path.extname(pathname).length > 0;
    if (pathname === '/' || pathname === '' || !hasExt) {
      pathname = '/index.html';
    }
    const filePath = path.join(RENDERER_ROOT, pathname);
    // Prevent path traversal outside the renderer root.
    if (!filePath.startsWith(RENDERER_ROOT)) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function loadRoute(win: BrowserWindow, route = ''): void {
  if (isDev) {
    win.loadURL(`${DEV_URL}/${route}`);
  } else {
    win.loadURL(`${APP_SCHEME}://app/${route}`);
  }
}

function createPOSWindow(): void {
  // The REGISTER window always opens on the PRIMARY Windows display — pinned
  // explicitly (centred in its work area), never left to implicit placement,
  // so the client window (secondary-only) can never trade places with it.
  const primary = screen.getPrimaryDisplay();
  const width = Math.min(1280, primary.workArea.width);
  const height = Math.min(800, primary.workArea.height);
  const x = primary.workArea.x + Math.max(0, Math.round((primary.workArea.width - width) / 2));
  const y = primary.workArea.y + Math.max(0, Math.round((primary.workArea.height - height) / 2));
  // eslint-disable-next-line no-console
  console.log(
    `[pos-window] primary display ${primary.id} bounds=${JSON.stringify(primary.bounds)} → POS window at ${JSON.stringify({ x, y, width, height })}`,
  );
  posWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: 1024,
    minHeight: 700,
    title: "The Wesley's POS",
    backgroundColor: '#0f0f19',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  loadRoute(posWindow);

  posWindow.once('ready-to-show', () => posWindow?.show());
  if (isDev) posWindow.webContents.openDevTools({ mode: 'detach' });

  // Open external links in the user's browser, never in-app.
  posWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Clear, non-technical error screen when the renderer fails to load
  // (e.g. dev server down, or — relevant to the API — a blank app).
  posWindow.webContents.on('did-fail-load', (_e, errorCode, errorDesc, validatedURL) => {
    // -3 = ERR_ABORTED (normal during navigation) — ignore.
    if (errorCode === -3) return;
    posWindow?.loadURL(errorPage(errorDesc || `Code ${errorCode}`, validatedURL));
  });

  posWindow.on('closed', () => {
    posWindow = null;
    customerDisplay?.dispose();
    customerDisplay = null;
  });
}

/** Inline data-URL error page — no network needed, shown if renderer fails. */
function errorPage(detail: string, url: string): string {
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>POS Caisse</title>
<style>
  html,body{height:100%;margin:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;
    background:#0f0f19;color:#e7e7ee;display:flex;align-items:center;justify-content:center}
  .box{max-width:480px;text-align:center;padding:40px}
  h1{font-size:20px;margin:0 0 12px}
  p{color:#9a9ab0;line-height:1.5;margin:0 0 24px;font-size:14px}
  code{background:#1d1d2b;padding:2px 6px;border-radius:6px;font-size:12px;color:#c0c0d0}
  button{background:#4f46e5;color:#fff;border:0;padding:12px 22px;border-radius:10px;
    font-size:14px;font-weight:600;cursor:pointer}
  button:hover{background:#4338ca}
</style></head><body>
  <div class="box">
    <h1>Connexion au serveur impossible</h1>
    <p>POS Caisse n'a pas pu charger l'application.<br>
    Vérifiez votre connexion réseau et que le serveur est accessible.</p>
    <p><code>${escapeHtml(detail)}</code></p>
    <button onclick="location.reload()">Réessayer</button>
  </div>
</body></html>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

// ── Single-instance lock: double-clicking again focuses the existing window ──
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (posWindow) {
      if (posWindow.isMinimized()) posWindow.restore();
      posWindow.focus();
    }
  });

  app.whenReady().then(() => {
    if (!isDev) registerAppProtocol();
    createPOSWindow();

    // Impression ticket via le spooler OS (PR #33) — honest-fail, IPC borné.
    registerPosPrintingIpc();
    // Impression RAW ESC/POS (tiroir-caisse + coupe) via le spooler Windows.
    registerPosRawPrintIpc();

    // Identité machine stable (Partie B — enrôlement). IPC borné, renvoie un UUID.
    registerMachineIdIpc();

    // Managed customer display (screen 2): screen selection, on/off, reload,
    // fullscreen/kiosk, crash watchdog, persistence, IPC control.
    customerDisplay = new CustomerDisplayController({
      loadRoute,
      preloadPath: path.join(__dirname, 'preload.js'),
      backgroundColor: '#000000',
    });
    customerDisplay.registerIpc();
    customerDisplay.open();

    // Mise à jour automatique (electron-updater + GitHub Releases). Ne bloque
    // jamais la caisse ; désactivée en dev/non-packagé ; installe hors vente.
    updateController = new UpdateController();
    updateController.start();

    app.on('activate', () => {
      if (!posWindow) createPOSWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
