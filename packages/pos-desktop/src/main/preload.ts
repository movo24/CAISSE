/**
 * Electron preload — runs in an isolated context with access to a minimal,
 * safe bridge. We expose ONLY non-sensitive metadata; no Node APIs, no secrets.
 *
 * The renderer can read `window.posDesktop` to know it runs inside the desktop
 * shell (e.g. to show a "Desktop" badge or adjust safe-areas). Nothing here
 * grants filesystem or shell access.
 *
 * Runs with sandbox: true — only contextBridge + a limited `process`
 * (platform/versions) are available; process.env may be absent, hence the guard.
 */
import { contextBridge, ipcRenderer } from 'electron';

// Version réelle de l'app, lue depuis le main (app.getVersion → package.json
// packagé). Synchrone au chargement du preload ; repli 'dev' hors desktop.
let appVersion = 'dev';
try {
  appVersion = (ipcRenderer.sendSync('app:getVersion') as string) || 'dev';
} catch {
  appVersion = 'dev';
}

// MODE TEST pilote — configuration du contournement de verrou de session, lue
// SYNCHRONE au chargement depuis le main (variables d'env système). Le renderer
// ne fait que LIRE cet objet ; il ne peut jamais activer le bypass lui-même.
// Hors desktop / erreur → mode test désactivé (comportement de sécurité normal).
let sessionTestBypass: { enabled: boolean; stores: string; terminals: string } = {
  enabled: false,
  stores: '',
  terminals: '',
};
try {
  const cfg = ipcRenderer.sendSync('app:sessionTestBypass') as typeof sessionTestBypass;
  if (cfg && typeof cfg.enabled === 'boolean') sessionTestBypass = cfg;
} catch {
  /* mode test désactivé par défaut */
}

contextBridge.exposeInMainWorld('posDesktop', {
  isDesktop: true,
  platform: process.platform,
  version: appVersion,
  // Sonde réseau côté MAIN (sans CORS) — diagnostic terrain du login.
  // Retourne { ok, status } ou { ok:false, errorCode } + ms.
  diagProbe: (url: string) => ipcRenderer.invoke('diag:probe', url),
  // MODE TEST pilote : { enabled, stores, terminals } — voir main/index.ts.
  sessionTestBypass,
});

/**
 * Pont mise à jour automatique (electron-updater). Le renderer peut : lire
 * l'état, forcer une vérification, changer de canal, déclencher l'installation
 * (gardée côté main : refusée si vente/paiement/impression/sync en cours), et
 * remonter l'état d'activité de la caisse pour que le main sache si c'est sûr.
 */
contextBridge.exposeInMainWorld('posUpdater', {
  getState: () => ipcRenderer.invoke('pos-update:getState'),
  check: () => ipcRenderer.invoke('pos-update:check'),
  installNow: () => ipcRenderer.invoke('pos-update:installNow'),
  setChannel: (channel: 'stable' | 'pilot') => ipcRenderer.invoke('pos-update:setChannel', channel),
  setActivity: (activity: { saleInProgress?: boolean; paymentInProgress?: boolean; printing?: boolean; syncing?: boolean }) =>
    ipcRenderer.send('pos-update:setActivity', activity),
  onEvent: (cb: (state: unknown) => void) => {
    const listener = (_e: unknown, state: unknown) => cb(state);
    ipcRenderer.on('pos-update:event', listener);
    return () => ipcRenderer.removeListener('pos-update:event', listener);
  },
});

/**
 * Impression ticket desktop (PR #33) — deux canaux étroits vers le main :
 * liste des imprimantes OS + impression silencieuse d'un reçu HTML (généré
 * localement par DOM sûr côté renderer). Résout { ok:false } en cas d'échec —
 * jamais de faux succès (règle d'honnêteté PR #27). Rien d'autre n'est exposé.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  getPrinters: () => ipcRenderer.invoke('pos-print:getPrinters'),
  // `paperWidthMm` sert à composer la fenêtre de rendu à la largeur du rouleau
  // ET à calculer le `pageSize` explicite transmis au moteur d'impression.
  printTicketHtml: (
    html: string,
    deviceName?: string,
    paperWidthMm?: 58 | 80,
    forcePageSize?: boolean,
  ) => ipcRenderer.invoke('pos-print:printHtml', html, deviceName, paperWidthMm, forcePageSize),
  // Tiroir-caisse : `opts.path` = 'raw' (kick ESC/POS) ou 'queue' (job driver
  // vers une file Windows dédiée — imprimantes raster TSP100/futurePRNT).
  // Décision prise côté renderer selon le driver réel (honest-fail).
  openCashDrawer: (deviceName?: string, opts?: { path?: 'raw' | 'queue'; queueName?: string }) =>
    ipcRenderer.invoke('pos-print:openDrawer', deviceName, opts),
  // Driver + port de la file Windows (détection du mode réel de l'imprimante).
  getPrinterInfo: (deviceName?: string) => ipcRenderer.invoke('pos-print:getPrinterInfo', deviceName),
  // État RÉEL de toutes les files Windows (statut, hors connexion, jobs en
  // attente) : sert à expliquer un job « soumis » qui ne sort pas physiquement.
  listQueues: () => ipcRenderer.invoke('pos-print:listQueues'),
  // Diagnostic : rend le ticket en PDF par le même pipeline Chromium et ouvre
  // le fichier — seul moyen de VOIR ce que le moteur d'impression a composé.
  diagnosticPdf: (html: string, paperWidthMm?: 58 | 80) =>
    ipcRenderer.invoke('pos-print:diagnosticPdf', html, paperWidthMm),
  cutPaper: (deviceName?: string) => ipcRenderer.invoke('pos-print:cut', deviceName),
  rawEscpos: (deviceName: string | undefined, bytes: number[]) =>
    ipcRenderer.invoke('pos-print:rawEscpos', deviceName, bytes),
  // Identité machine stable (Partie B — enrôlement) : UUID persistant en userData.
  getMachineId: () => ipcRenderer.invoke('machine:getId') as Promise<string>,
});

/**
 * Native control bridge for the customer display (screen 2). Only the operator
 * window uses these; they manage the physical window (screen selection, on/off,
 * reload, fullscreen/kiosk) via IPC to the main process. Content sync stays on
 * BroadcastChannel. When absent (web build), the renderer degrades gracefully.
 */
contextBridge.exposeInMainWorld('customerDisplayNative', {
  isAvailable: true,
  getStatus: () => ipcRenderer.invoke('customer-display:getStatus'),
  listDisplays: () => ipcRenderer.invoke('customer-display:listDisplays'),
  open: () => ipcRenderer.invoke('customer-display:open'),
  close: () => ipcRenderer.invoke('customer-display:close'),
  reload: () => ipcRenderer.invoke('customer-display:reload'),
  setEnabled: (enabled: boolean) => ipcRenderer.invoke('customer-display:setEnabled', enabled),
  setScreen: (screenId: number | null) => ipcRenderer.invoke('customer-display:setScreen', screenId),
  setFullscreen: (fullscreen: boolean) => ipcRenderer.invoke('customer-display:setFullscreen', fullscreen),
  setKiosk: (kiosk: boolean) => ipcRenderer.invoke('customer-display:setKiosk', kiosk),
  onStatus: (cb: (status: unknown) => void) => {
    const listener = (_e: unknown, status: unknown) => cb(status);
    ipcRenderer.on('customer-display:status', listener);
    return () => ipcRenderer.removeListener('customer-display:status', listener);
  },
});
