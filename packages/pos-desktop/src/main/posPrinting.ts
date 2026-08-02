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

/**
 * `loadURL` résout sur `did-finish-load` : cela ne garantit PAS que le logo et
 * le QR (deux <img> en data-URL) sont décodés ni que la police est prête. Un
 * ticket imprimé avant décodage sort vide ou amputé de son en-tête, alors que
 * Windows a bien accepté le job. Borné : on n'attend jamais indéfiniment.
 */
const RENDER_READY_TIMEOUT_MS = 5_000;

/**
 * Le callback de `webContents.print()` signale la REMISE au spouleur, pas la
 * fin de l'aspiration du document. Détruire la fenêtre dans la foulée peut
 * tronquer le job — cause classique de « print success » sans papier. On laisse
 * donc le spouleur finir avant `destroy()`.
 */
const SPOOL_SETTLE_MS = 1_500;

/** Attend polices + images réellement décodées. Jamais bloquant, jamais throw. */
async function waitForRenderReady(win: BrowserWindow): Promise<void> {
  const script = `(async () => {
    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) {}
    const imgs = Array.from(document.images || []);
    await Promise.all(imgs.map((i) => {
      if (i.complete && i.naturalWidth > 0) return null;
      return i.decode ? i.decode().catch(() => null) : null;
    }));
    return document.images.length;
  })()`;
  try {
    await Promise.race([
      win.webContents.executeJavaScript(script, true),
      new Promise((resolve) => setTimeout(resolve, RENDER_READY_TIMEOUT_MS)),
    ]);
  } catch {
    /* rendu non sondable → on imprime quand même, jamais de blocage */
  }
}

/** Options d'impression silencieuse pour un reçu thermique 80 mm. */
export function buildReceiptPrintOptions(deviceName?: string): Electron.WebContentsPrintOptions {
  return {
    silent: true,
    printBackground: false,
    margins: { marginType: 'none' },
    ...(deviceName ? { deviceName } : {}),
  };
}

/** Chronométrage réel des étapes (diagnostic latence terrain — TSP143). */
export interface PrintTimings {
  /** Création de la fenêtre cachée (ms). */
  windowMs: number;
  /** Chargement/mise en page du HTML du ticket (ms). */
  loadMs: number;
  /** Remise au spooler → callback du driver (ms). */
  spoolMs: number;
  totalMs: number;
}

async function printHtmlSilently(
  html: string,
  deviceName?: string,
): Promise<{ ok: boolean; error?: string; timings?: PrintTimings }> {
  let win: BrowserWindow | null = null;
  const t0 = Date.now();
  try {
    win = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    const t1 = Date.now();
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    // Logo + QR décodés AVANT l'impression (sinon ticket vide/amputé).
    await waitForRenderReady(win);
    const t2 = Date.now();
    const result = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, error: 'print timeout' }), PRINT_TIMEOUT_MS);
      win!.webContents.print(buildReceiptPrintOptions(deviceName), (success, failureReason) => {
        clearTimeout(timer);
        resolve(success ? { ok: true } : { ok: false, error: failureReason || 'print failed' });
      });
    });
    const t3 = Date.now();
    // Laisse le spouleur aspirer le document avant `destroy()` (finally) :
    // détruire trop tôt tronque le job et ne produit aucun papier.
    if (result.ok) {
      await new Promise((resolve) => setTimeout(resolve, SPOOL_SETTLE_MS));
    }
    const timings: PrintTimings = {
      windowMs: t1 - t0,
      loadMs: t2 - t1,
      spoolMs: t3 - t2,
      totalMs: Date.now() - t0,
    };
    // eslint-disable-next-line no-console
    console.info('[PRINT-TIMING]', JSON.stringify({ deviceName: deviceName ?? '(défaut OS)', ...timings, ok: result.ok }));
    return { ...result, timings };
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
