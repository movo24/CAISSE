/**
 * Impression ticket desktop (PR #33) — via le spooler d'impression de l'OS.
 *
 * Le renderer fournit le HTML du reçu (construit par DOM sûr, valeurs échappées,
 * 80 mm) ; le main l'imprime en silencieux dans une fenêtre cachée vers
 * l'imprimante par défaut de l'OS (drivers thermiques Windows inclus).
 *
 * HONNÊTETÉ (règle PR #27) : toute défaillance résout `{ ok: false }` — jamais
 * un faux succès. Aucune dépendance native ; IPC borné à deux canaux.
 */
import { BrowserWindow, ipcMain } from 'electron';

const PRINT_TIMEOUT_MS = 20_000;

/** Options d'impression silencieuse pour un reçu thermique 80 mm. */
export function buildReceiptPrintOptions(deviceName?: string): Electron.WebContentsPrintOptions {
  return {
    silent: true,
    printBackground: false,
    margins: { marginType: 'none' },
    ...(deviceName ? { deviceName } : {}),
  };
}

async function printHtmlSilently(html: string, deviceName?: string): Promise<{ ok: boolean; error?: string }> {
  let win: BrowserWindow | null = null;
  try {
    win = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const result = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, error: 'print timeout' }), PRINT_TIMEOUT_MS);
      win!.webContents.print(buildReceiptPrintOptions(deviceName), (success, failureReason) => {
        clearTimeout(timer);
        resolve(success ? { ok: true } : { ok: false, error: failureReason || 'print failed' });
      });
    });
    return result;
  } catch (e: any) {
    return { ok: false, error: e?.message || 'print error' };
  } finally {
    win?.destroy();
  }
}

/** Enregistre les canaux IPC d'impression (appelé au démarrage du main). */
export function registerPosPrintingIpc(): void {
  ipcMain.handle('pos-print:getPrinters', async () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return [];
    const printers = await win.webContents.getPrintersAsync();
    return printers.map((p) => p.name);
  });

  ipcMain.handle('pos-print:printHtml', async (_event, html: unknown, deviceName?: unknown) => {
    if (typeof html !== 'string' || html.length === 0 || html.length > 500_000) {
      return { ok: false, error: 'invalid html payload' };
    }
    const device = typeof deviceName === 'string' && deviceName ? deviceName : undefined;
    return printHtmlSilently(html, device);
  });
}
