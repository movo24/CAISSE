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
import { BrowserWindow, ipcMain, type NativeImage } from 'electron';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import {
  STAR_DPI,
  computeBitmapHeightPx,
  computeRenderGeometry,
  printPngViaGdi,
} from './posImagePrint';

/**
 * Après redimensionnement de la fenêtre hors écran à la hauteur du ticket, on
 * laisse Chromium repeindre avant de capturer : capturer trop tôt donne une
 * image tronquée (haut du ticket seulement).
 */
const RENDER_SETTLE_MS = 400;

/**
 * `loadURL` résout sur `did-finish-load` : cela ne garantit PAS que le logo et
 * le QR (deux <img> en data-URL) sont décodés ni que la police est prête. Un
 * ticket imprimé avant décodage sort vide ou amputé de son en-tête, alors que
 * Windows a bien accepté le job. Borné : on n'attend jamais indéfiniment.
 */
const RENDER_READY_TIMEOUT_MS = 5_000;

/** 1 px CSS à 96 dpi = 25,4/96 mm. Conversion exacte px → microns. */
export const MICRONS_PER_CSS_PX = (25.4 / 96) * 1000;

/** Marge de sécurité en bas du ticket (évite une dernière ligne rognée). */
export const PAGE_HEIGHT_SAFETY_MICRONS = 5_000; // 5 mm

/** Bornes de hauteur : ni page dégénérée, ni mètre de papier gaspillé. */
export const MIN_PAGE_HEIGHT_MICRONS = 30_000; // 30 mm
export const MAX_PAGE_HEIGHT_MICRONS = 1_200_000; // 1,2 m

/**
 * Mesure du ticket + format de page qui en découle. PUR — c'est ici que vit la
 * règle qui remplace `@page size: 80mm auto` et le format par défaut du pilote.
 */
export interface PageGeometry {
  scrollHeightPx: number;
  pageWidthMicrons: number;
  pageHeightMicrons: number;
  /** true si la hauteur mesurée a été bornée (donc suspecte). */
  clamped: boolean;
}

/**
 * Convertit une hauteur de contenu (px CSS) en format de page explicite.
 *
 * `@page { size: 80mm auto }` n'est PAS honoré par `webContents.print()` : le
 * format vient du pilote Windows. Sur une Star restée en Letter/A4, cela donne
 * une page immense (ticket perdu) ou un format court (ticket tronqué). On
 * impose donc un `pageSize` calculé sur la hauteur RÉELLE du document.
 */
export function computePageGeometry(scrollHeightPx: number, paperWidthMm: number): PageGeometry {
  const px = Number.isFinite(scrollHeightPx) && scrollHeightPx > 0 ? scrollHeightPx : 0;
  const raw = Math.round(px * MICRONS_PER_CSS_PX) + PAGE_HEIGHT_SAFETY_MICRONS;
  const bounded = Math.min(MAX_PAGE_HEIGHT_MICRONS, Math.max(MIN_PAGE_HEIGHT_MICRONS, raw));
  return {
    scrollHeightPx: px,
    pageWidthMicrons: Math.round(paperWidthMm * 1000),
    pageHeightMicrons: bounded,
    clamped: bounded !== raw,
  };
}

/** Largeur de la fenêtre de rendu, en px CSS, pour composer à la largeur du rouleau. */
export function paperWidthToPx(paperWidthMm: number): number {
  return Math.max(120, Math.round((paperWidthMm / 25.4) * 96));
}

/**
 * Attend que le document soit VRAIMENT peint, puis mesure sa hauteur.
 *
 * Polices prêtes + images décodées + DEUX cycles de rendu (double
 * `requestAnimationFrame`) : après le second, la mise en page est stabilisée et
 * `scrollHeight` reflète le ticket complet. Retourne 0 si non sondable —
 * l'appelant décide alors, il n'y a jamais de blocage.
 */
async function waitForRenderReadyAndMeasure(win: BrowserWindow): Promise<number> {
  const script = `(async () => {
    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) {}
    const imgs = Array.from(document.images || []);
    await Promise.all(imgs.map((i) => {
      if (i.complete && i.naturalWidth > 0) return null;
      return i.decode ? i.decode().catch(() => null) : null;
    }));
    // DEUX cycles de rendu : le premier applique la mise en page, le second
    // garantit qu'elle est stabilisée avant toute mesure.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const d = document.documentElement, b = document.body;
    return Math.max(
      d ? d.scrollHeight : 0, b ? b.scrollHeight : 0,
      b ? Math.ceil(b.getBoundingClientRect().bottom) : 0,
    );
  })()`;
  try {
    const h = await Promise.race([
      win.webContents.executeJavaScript(script, true),
      new Promise<number>((resolve) => setTimeout(() => resolve(0), RENDER_READY_TIMEOUT_MS)),
    ]);
    return typeof h === 'number' && Number.isFinite(h) ? h : 0;
  } catch {
    return 0; /* rendu non sondable → on imprime quand même */
  }
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

/**
 * Ce qui est RÉELLEMENT transmis au moteur d'impression — remonté au renderer
 * pour être journalisé et affiché. `pageSize: null` signifie « aucun format
 * imposé : c'est le format par défaut du pilote Windows qui s'applique », une
 * information décisive quand un ticket sort blanc ou tronqué.
 */
export interface PrintOptionsUsed {
  deviceName: string | null;
  pageSize: string | null;
  margins: string;
  printBackground: boolean;
}

/**
 * Aperçu du bitmap EXACT remis au pilote. C'est la seule preuve directe que le
 * document imprimé contenait bien le ticket — un « success » ne dit rien du
 * contenu. On réduit pour l'IPC : l'aperçu sert à VOIR, pas à archiver.
 */
async function capturePreview(image: NativeImage): Promise<string | null> {
  try {
    if (image.isEmpty()) return null;
    const url = image.resize({ width: 300, quality: 'good' }).toDataURL();
    return url && url.length > 128 ? url : null;
  } catch {
    return null;
  }
}

/**
 * Imprime le ticket. Chemin : rendu HORS ÉCRAN (OSR) → bitmap → GDI natif.
 *
 * `webContents.print()` n'est PLUS utilisé : mesuré sur la caisse, il ne remet
 * aucune opération de dessin au pilote Star (61 octets, 0 % d'encre, coupe
 * immédiate) tout en répondant `success`. Détail complet dans `posImagePrint.ts`.
 *
 * Deux pièges du rendu hors écran, tous deux mesurés — ne pas les réintroduire :
 *  - une fenêtre `show:false` SANS `offscreen:true` ne se compose pas :
 *    `capturePage()` ne résout jamais (blocage) ;
 *  - une fenêtre déplacée hors des écrans (`x:-20000`) rend une image VIDE
 *    (0 octet), sans erreur.
 * Seul l'OSR Chromium (`webPreferences.offscreen`) rasterise de façon fiable.
 */
async function printHtmlSilently(
  html: string,
  deviceName?: string,
  paperWidthMm = 80,
): Promise<{
  ok: boolean;
  error?: string;
  timings?: PrintTimings;
  optionsUsed?: PrintOptionsUsed;
  geometry?: PageGeometry;
  previewDataUrl?: string | null;
}> {
  let win: BrowserWindow | null = null;
  let pngPath: string | null = null;
  const t0 = Date.now();
  const render = computeRenderGeometry(paperWidthMm);
  try {
    win = new BrowserWindow({
      show: false,
      // Largeur en POINTS IMPRIMANTE (203 dpi) ; le zoom ci-dessous ramène le
      // viewport CSS à la largeur 96 dpi attendue par le gabarit du ticket.
      // Le texte est donc rasterisé nativement à 203 dpi (net), pas agrandi.
      width: render.deviceWidthPx,
      height: 1200,
      useContentSize: true,
      frame: false,
      skipTaskbar: true,
      paintWhenInitiallyHidden: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        offscreen: true,
      },
    });
    win.webContents.setZoomFactor(render.zoomFactor);
    const t1 = Date.now();
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    // Polices + images décodées + 2 cycles de rendu, PUIS mesure réelle.
    const scrollHeightPx = await waitForRenderReadyAndMeasure(win);
    const geometry = computePageGeometry(scrollHeightPx, paperWidthMm);
    // Hauteur du bitmap en points imprimante, puis capture pleine hauteur.
    const bitmapHeightPx = computeBitmapHeightPx(scrollHeightPx);
    win.setContentSize(render.deviceWidthPx, bitmapHeightPx);
    await new Promise((resolve) => setTimeout(resolve, RENDER_SETTLE_MS));

    const image = await win.webContents.capturePage();
    if (image.isEmpty()) {
      return { ok: false, error: 'rendu du ticket vide (capture hors écran)', geometry };
    }
    const png = image.toPNG();
    if (!png || png.length === 0) {
      return { ok: false, error: 'rendu du ticket illisible (PNG vide)', geometry };
    }
    pngPath = path.join(os.tmpdir(), `poscaisse-ticket-${Date.now()}.png`);
    fs.writeFileSync(pngPath, png);

    // Aperçu : preuve directe de CE QUI a été rasterisé (un « success » ne dit
    // rien du contenu). Réduit pour l'IPC.
    const previewDataUrl = await capturePreview(image);
    const t2 = Date.now();

    const target = deviceName || '';
    const optionsUsed: PrintOptionsUsed = {
      deviceName: deviceName ?? null,
      pageSize: `${render.printableMm}mm @ ${STAR_DPI}dpi → ${render.deviceWidthPx}x${bitmapHeightPx}px`,
      margins: 'none',
      printBackground: true,
    };
    const result = target
      ? await printPngViaGdi(pngPath, target)
      : { ok: false, error: 'aucune imprimante sélectionnée pour le ticket' };
    const t3 = Date.now();

    const timings: PrintTimings = {
      windowMs: t1 - t0,
      loadMs: t2 - t1,
      spoolMs: t3 - t2,
      totalMs: Date.now() - t0,
    };
    // eslint-disable-next-line no-console
    console.info(
      '[PRINT-TIMING]',
      JSON.stringify({
        path: 'offscreen-bitmap-gdi',
        ...optionsUsed,
        scrollHeightPx: geometry.scrollHeightPx,
        bitmapHeightPx,
        pngBytes: png.length,
        previewCaptured: !!previewDataUrl,
        ...timings,
        ok: result.ok,
        error: result.error,
      }),
    );
    return { ...result, timings, optionsUsed, geometry, previewDataUrl };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'print error' };
  } finally {
    win?.destroy();
    if (pngPath) {
      try {
        fs.unlinkSync(pngPath);
      } catch {
        /* nettoyage best-effort */
      }
    }
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

  ipcMain.handle(
    'pos-print:printHtml',
    async (_event, html: unknown, deviceName?: unknown, paperWidthMm?: unknown) => {
      if (typeof html !== 'string' || html.length === 0 || html.length > 500_000) {
        return { ok: false, error: 'invalid html payload' };
      }
      const device = typeof deviceName === 'string' && deviceName ? deviceName : undefined;
      const width = paperWidthMm === 58 || paperWidthMm === 80 ? paperWidthMm : 80;
      return printHtmlSilently(html, device, width);
    },
  );
}
