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

/**
 * Options d'impression. `pageSize` EXPLICITE : on ne dépend plus du format par
 * défaut du pilote. Marges à zéro, fond imprimé, imprimante nommée exactement.
 */
export function buildReceiptPrintOptions(
  deviceName?: string,
  geometry?: PageGeometry,
  forcePageSize = false,
): Electron.WebContentsPrintOptions {
  return {
    silent: true,
    // Le ticket est noir sur blanc, mais certains éléments (bandeau de test,
    // séparateurs) reposent sur des fonds : sans cela ils disparaissent.
    printBackground: true,
    margins: { marginType: 'none' },
    // Par DÉFAUT on laisse le formulaire rouleau du pilote décider : la page de
    // test Windows sort entière et coupe à la fin, ce qui prouve que ce
    // formulaire est correct et que sa longueur suit le contenu. Imposer une
    // hauteur fixe serait au mieux inutile, au pire refusé par le pilote (un
    // format absent de ses formulaires n'est pas honoré).
    // Le forçage reste disponible depuis l'écran diagnostic si un poste a un
    // formulaire mal réglé.
    ...(forcePageSize && geometry
      ? { pageSize: { width: geometry.pageWidthMicrons, height: geometry.pageHeightMicrons } }
      : {}),
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

function describePrintOptions(o: Electron.WebContentsPrintOptions): PrintOptionsUsed {
  const ps = (o as { pageSize?: unknown }).pageSize;
  return {
    deviceName: o.deviceName ?? null,
    pageSize: ps == null ? null : typeof ps === 'string' ? ps : JSON.stringify(ps),
    margins: o.margins?.marginType ?? 'default',
    printBackground: o.printBackground === true,
  };
}

/**
 * Capture la fenêtre EXACTE qui part à l'impression, au moment précis du
 * lancement. C'est la seule preuve directe que le document imprimé contenait
 * bien le ticket — un « print success » ne dit rien du contenu.
 */
async function capturePreview(win: BrowserWindow): Promise<string | null> {
  try {
    const img = await win.webContents.capturePage();
    if (img.isEmpty()) return null;
    // Réduit pour l'IPC : l'aperçu sert à VOIR le ticket, pas à l'archiver.
    const scaled = img.resize({ width: 300, quality: 'good' });
    const url = scaled.toDataURL();
    return url && url.length > 128 ? url : null;
  } catch {
    return null;
  }
}

async function printHtmlSilently(
  html: string,
  deviceName?: string,
  paperWidthMm = 80,
  forcePageSize = false,
): Promise<{
  ok: boolean;
  error?: string;
  timings?: PrintTimings;
  optionsUsed?: PrintOptionsUsed;
  geometry?: PageGeometry;
  previewDataUrl?: string | null;
}> {
  let win: BrowserWindow | null = null;
  const t0 = Date.now();
  try {
    win = new BrowserWindow({
      // ── CAUSE RACINE du « petit bout coupé aussitôt » ────────────────────
      // Une fenêtre `show: false` n'est PAS composée par Chromium : aucune
      // frame n'est produite, et `webContents.print()` sérialise alors un
      // document sans contenu peint. Sur un formulaire rouleau — dont la
      // longueur suit le contenu (prouvé par la page de test Windows, qui
      // sort entière) — cela donne exactement quelques millimètres de papier
      // suivis de la coupe de fin de document.
      //
      // La fenêtre est donc RÉELLEMENT affichée, mais hors de l'espace de
      // travail : invisible pour le caissier, et pourtant composée.
      show: true,
      x: -32000,
      y: -32000,
      // Fenêtre à la LARGEUR DU ROULEAU : le document se compose exactement
      // comme il sera imprimé, donc `scrollHeight` mesure la vraie hauteur.
      width: paperWidthToPx(paperWidthMm),
      height: 1200,
      frame: false,
      skipTaskbar: true,
      focusable: false,
      // Ne vole jamais le focus de la caisse pendant une vente.
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        // Une fenêtre hors écran est considérée « en arrière-plan » : sans
        // cela Chromium bride le rendu et on retombe sur le document vide.
        backgroundThrottling: false,
      },
    });
    win.setIgnoreMouseEvents(true);
    const t1 = Date.now();
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    // Polices + images décodées + 2 cycles de rendu, PUIS mesure réelle.
    const scrollHeightPx = await waitForRenderReadyAndMeasure(win);
    const geometry = computePageGeometry(scrollHeightPx, paperWidthMm);
    const previewDataUrl = await capturePreview(win);
    const t2 = Date.now();
    const printOptions = buildReceiptPrintOptions(deviceName, geometry, forcePageSize);
    const optionsUsed = describePrintOptions(printOptions);
    const result = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, error: 'print timeout' }), PRINT_TIMEOUT_MS);
      win!.webContents.print(printOptions, (success, failureReason) => {
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
    console.info(
      '[PRINT-TIMING]',
      JSON.stringify({
        ...optionsUsed,
        scrollHeightPx: geometry.scrollHeightPx,
        pageWidthMicrons: geometry.pageWidthMicrons,
        pageHeightMicrons: geometry.pageHeightMicrons,
        heightClamped: geometry.clamped,
        previewCaptured: !!previewDataUrl,
        ...timings,
        ok: result.ok,
      }),
    );
    return { ...result, timings, optionsUsed, geometry, previewDataUrl };
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

  ipcMain.handle(
    'pos-print:printHtml',
    async (
      _event,
      html: unknown,
      deviceName?: unknown,
      paperWidthMm?: unknown,
      forcePageSize?: unknown,
    ) => {
      if (typeof html !== 'string' || html.length === 0 || html.length > 500_000) {
        return { ok: false, error: 'invalid html payload' };
      }
      const device = typeof deviceName === 'string' && deviceName ? deviceName : undefined;
      const width = paperWidthMm === 58 || paperWidthMm === 80 ? paperWidthMm : 80;
      return printHtmlSilently(html, device, width, forcePageSize === true);
    },
  );
}
