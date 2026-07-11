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

contextBridge.exposeInMainWorld('posDesktop', {
  isDesktop: true,
  platform: process.platform,
  // App version is injected at build time via env; falls back to 'dev'.
  version: process.env?.POS_APP_VERSION || 'dev',
});

/**
 * Impression ticket desktop (PR #33) — deux canaux étroits vers le main :
 * liste des imprimantes OS + impression silencieuse d'un reçu HTML (généré
 * localement par DOM sûr côté renderer). Résout { ok:false } en cas d'échec —
 * jamais de faux succès (règle d'honnêteté PR #27). Rien d'autre n'est exposé.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  getPrinters: () => ipcRenderer.invoke('pos-print:getPrinters'),
  printTicketHtml: (html: string, deviceName?: string) =>
    ipcRenderer.invoke('pos-print:printHtml', html, deviceName),
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
