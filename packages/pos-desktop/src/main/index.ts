/**
 * Electron Main Process
 *
 * Creates two windows:
 * 1. POS Window (operator) - main interaction screen
 * 2. Client Display Window - customer-facing display
 *
 * For MVP, both windows point to the same Vite dev server
 * with different routes.
 */

import { app, BrowserWindow, screen } from 'electron';
import * as path from 'path';

let posWindow: BrowserWindow | null = null;
let clientWindow: BrowserWindow | null = null;

const isDev = process.env.NODE_ENV !== 'production';
const DEV_URL = 'http://localhost:5174';

function createPOSWindow() {
  posWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'CAISSE POS',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (isDev) {
    posWindow.loadURL(DEV_URL);
    posWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    posWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  posWindow.on('closed', () => {
    posWindow = null;
    clientWindow?.close();
  });
}

function createClientWindow() {
  // Try to find a second display
  const displays = screen.getAllDisplays();
  const secondDisplay = displays.find(
    (d) => d.id !== screen.getPrimaryDisplay().id,
  );

  const bounds = secondDisplay?.bounds || {
    x: screen.getPrimaryDisplay().bounds.width,
    y: 0,
    width: 1024,
    height: 768,
  };

  clientWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width || 1024,
    height: bounds.height || 768,
    title: 'CAISSE - Ecran Client',
    fullscreen: !!secondDisplay,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const clientUrl = isDev
    ? `${DEV_URL}/client-display`
    : `file://${path.join(__dirname, '../renderer/index.html')}#/client-display`;

  clientWindow.loadURL(clientUrl);

  clientWindow.on('closed', () => {
    clientWindow = null;
  });
}

app.whenReady().then(() => {
  createPOSWindow();
  createClientWindow();

  app.on('activate', () => {
    if (!posWindow) createPOSWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
