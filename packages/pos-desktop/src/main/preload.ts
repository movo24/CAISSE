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
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('posDesktop', {
  isDesktop: true,
  platform: process.platform,
  // App version is injected at build time via env; falls back to 'dev'.
  version: process.env?.POS_APP_VERSION || 'dev',
});
