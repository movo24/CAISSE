/**
 * Impression ticket desktop (PR #33) — rendu Chromium HORS ÉCRAN → bitmap →
 * GDI natif Windows.
 *
 * Le renderer fournit le HTML du reçu (construit par DOM sûr, valeurs échappées,
 * 80 mm) ; le main le rasterise hors écran puis remet le bitmap au pilote Star
 * par GDI (`posImagePrint.ts`).
 *
 * `webContents.print()` n'est PLUS utilisé pour le ticket : mesuré sur la
 * caisse (2026-08-04), il ne remet AUCUNE opération de dessin au pilote Star
 * TSP100/TSP143 (61 octets, 0 % d'encre, coupe immédiate) tout en répondant
 * `success`. Le même pilote, alimenté par GDI, sort physiquement le ticket.
 *
 * HONNÊTETÉ (règle PR #27) : toute défaillance résout `{ ok: false }` — jamais
 * un faux succès. GDI confirme la REMISE au spouleur, pas la sortie du papier.
 */
import { BrowserWindow, ipcMain, shell, type NativeImage } from 'electron';
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
 * `loadFile` résout sur `did-finish-load` : cela ne garantit PAS que le logo et
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
 * CSS injecté dans la fenêtre d'impression, mesuré indispensable au banc :
 *  - sans `overflow: hidden`, la barre de défilement verticale vole ~8 px CSS
 *    de viewport → le ticket (72 mm fixes) déborde et la capture est ROGNÉE à
 *    droite (« 2.00 EU », dernière ligne coupée) ;
 *  - le gabarit fait 72 mm de corps + 3 mm de marges = 78 mm, or le viewport
 *    de rendu EST la zone imprimable (72 mm). Les marges horizontales sont
 *    neutralisées : le rouleau a déjà ses marges physiques. La marge verticale
 *    du gabarit est conservée.
 */
export const PRINT_WINDOW_CSS =
  'html, body { overflow: hidden !important; } ' +
  'body { margin-left: 0 !important; margin-right: 0 !important; }';

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
 * Sert au PDF diagnostic (même pagination que l'impression) et au journal.
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
 * la mesure reflète le ticket complet. Retourne des zéros si non sondable —
 * l'appelant décide alors, il n'y a jamais de blocage.
 */
export interface RenderProbe {
  /** Hauteur retenue pour dimensionner la page (max des mesures), en px CSS. */
  h: number;
  docScrollWidth: number;
  docScrollHeight: number;
  bodyScrollWidth: number;
  bodyScrollHeight: number;
  /** Longueur du texte réellement rendu — 0 = document vide. */
  textLen: number;
  imgs: number;
  /** Images réellement décodées (naturalWidth > 0) : distingue « logo absent ». */
  imgsDecoded: number;
  readyState: string;
}

async function waitForRenderReadyAndMeasure(win: BrowserWindow): Promise<RenderProbe> {
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
    const imgsDecoded = imgs.filter((i) => i.complete && i.naturalWidth > 0).length;
    return {
      // HAUTEUR DU CONTENU — surtout PAS documentElement.scrollHeight, qui vaut
      // toujours AU MOINS la hauteur du viewport. Mesuré sous Electron 28 :
      // fenêtre 1200 px → docScrollHeight 1200, alors que le ticket fait 481 px.
      // Un Math.max() retenait donc la FENÊTRE et produisait une page de 322 mm
      // pour un ticket de 12,7 cm. On prend le bas réel du contenu.
      h: Math.max(
        b ? Math.ceil(b.getBoundingClientRect().bottom) : 0,
        b ? b.scrollHeight : 0,
      ),
      docScrollWidth: d ? d.scrollWidth : 0,
      docScrollHeight: d ? d.scrollHeight : 0,
      bodyScrollWidth: b ? b.scrollWidth : 0,
      bodyScrollHeight: b ? b.scrollHeight : 0,
      imgsDecoded,
      // Preuve que le DOM porte réellement du contenu (et pas une page vide
      // consécutive à une navigation ratée) : longueur du texte rendu.
      textLen: b && b.innerText ? b.innerText.length : 0,
      imgs: document.images ? document.images.length : 0,
      readyState: document.readyState,
    };
  })()`;
  const empty: RenderProbe = {
    h: 0, docScrollWidth: 0, docScrollHeight: 0, bodyScrollWidth: 0, bodyScrollHeight: 0,
    textLen: 0, imgs: 0, imgsDecoded: 0, readyState: 'unknown',
  };
  try {
    const r = await Promise.race([
      win.webContents.executeJavaScript(script, true) as Promise<RenderProbe>,
      new Promise<RenderProbe>((resolve) => setTimeout(() => resolve(empty), RENDER_READY_TIMEOUT_MS)),
    ]);
    return r && typeof r.h === 'number' && Number.isFinite(r.h) ? r : empty;
  } catch {
    return empty; /* rendu non sondable → l'appelant tranche */
  }
}

/**
 * Charge le document ET garantit qu'il porte réellement du contenu peint.
 *
 * Le PDF de diagnostic est sorti à 0 OCTET sur le terrain : Chromium composait
 * donc un document vide bien avant toute imprimante. `loadFile()` résout sur
 * `did-finish-load`, ce qui ne garantit ni la peinture ni même un DOM peuplé.
 * On attend donc la fin de chargement RÉELLE (`isLoading()` faux), puis la
 * sonde de rendu ; si le document est vide, on RECHARGE une fois avant de
 * renoncer. Aucun job n'est envoyé sur un document vide.
 *
 * `prepare` est rejoué après CHAQUE chargement : le zoom 203 dpi et le CSS
 * injecté sont annulés par toute navigation (mesuré au banc : zoom posé avant
 * `loadFile` → ticket à demi-largeur).
 */
async function loadAndProve(
  win: BrowserWindow,
  filePath: string,
  prepare?: () => Promise<void>,
): Promise<RenderProbe> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    await win.loadFile(filePath);
    // `loadFile` peut résoudre alors qu'un sous-chargement est encore en vol.
    if (win.webContents.isLoading()) {
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        win.webContents.once('did-stop-loading', done);
        setTimeout(done, RENDER_READY_TIMEOUT_MS);
      });
    }
    if (prepare) await prepare();
    const probe = await waitForRenderReadyAndMeasure(win);
    if (probe.textLen > 0 && probe.h > 0) return probe;
    // eslint-disable-next-line no-console
    console.warn(
      `[PERIPH] Document VIDE après chargement (tentative ${attempt}/2)`,
      JSON.stringify(probe),
    );
  }
  return waitForRenderReadyAndMeasure(win);
}

/** Chronométrage réel des étapes (diagnostic latence terrain — TSP143). */
export interface PrintTimings {
  /** Création de la fenêtre cachée (ms). */
  windowMs: number;
  /** Chargement/mise en page/rasterisation du ticket (ms). */
  loadMs: number;
  /** Remise au spouleur par GDI (ms). */
  spoolMs: number;
  totalMs: number;
}

/**
 * Ce qui est RÉELLEMENT transmis au moteur d'impression — remonté au renderer
 * pour être journalisé et affiché à l'écran diagnostic.
 */
export interface PrintOptionsUsed {
  deviceName: string | null;
  pageSize: string | null;
  margins: string;
  printBackground: boolean;
}

/**
 * Dossier de diagnostic d'impression, sur le Bureau : l'opérateur doit pouvoir
 * m'envoyer les fichiers sans aller les chercher dans un dossier temporaire.
 */
function diagnosticDir(): string {
  const base = path.join(os.homedir(), 'Desktop', 'CaisseDiagnostic');
  try { fs.mkdirSync(base, { recursive: true }); return base; } catch { return os.tmpdir(); }
}

/** Horodatage de fichier, stable et triable. */
function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/**
 * Écrit les TROIS artefacts qui partitionnent la panne, AVANT l'impression :
 *   ticket-<t>.html  le document exact soumis au moteur
 *   ticket-<t>.png   la fenêtre réellement peinte (LE bitmap remis à GDI)
 *   ticket-<t>.pdf   la composition Chromium (contre-épreuve indépendante)
 * HTML correct + PNG vide  → le rendu ne se fait pas.
 * PNG correct + PDF vide   → la composition d'impression échoue.
 * PNG/PDF corrects + papier nul → le pilote Windows est en cause.
 */
async function writeDiagnosticArtifacts(
  win: BrowserWindow,
  html: string,
  geometry: PageGeometry,
): Promise<{ htmlPath: string | null; pngPath: string | null; pdfPath: string | null; pdfBytes: number }> {
  const dir = diagnosticDir();
  const t = stamp();
  let htmlPath: string | null = null;
  let pngPath: string | null = null;
  let pdfPath: string | null = null;
  let pdfBytes = 0;
  try {
    htmlPath = path.join(dir, `ticket-${t}.html`);
    fs.writeFileSync(htmlPath, html, 'utf-8');
  } catch { htmlPath = null; }
  try {
    const img = await win.webContents.capturePage();
    if (!img.isEmpty()) {
      pngPath = path.join(dir, `ticket-${t}.png`);
      fs.writeFileSync(pngPath, img.toPNG());
    }
  } catch { pngPath = null; }
  try {
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      pageSize: {
        width: geometry.pageWidthMicrons / 25400,
        height: geometry.pageHeightMicrons / 25400,
      },
    });
    pdfBytes = pdf ? pdf.length : 0;
    if (pdfBytes > 0) {
      pdfPath = path.join(dir, `ticket-${t}.pdf`);
      fs.writeFileSync(pdfPath, pdf);
    }
  } catch { pdfPath = null; }
  return { htmlPath, pngPath, pdfPath, pdfBytes };
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
 * Imprime le ticket. Chemin : rendu HORS ÉCRAN (OSR) → bitmap 1bpp → GDI natif.
 *
 * Pièges du rendu, tous mesurés sur cette caisse — ne pas les réintroduire :
 *  - une fenêtre déplacée hors des écrans (`x:-32000`) fait ÉCHOUER `loadFile`
 *    (ERR_FAILED -2) → document vide → 1 mm de papier puis coupe ;
 *  - le zoom 203 dpi posé AVANT la navigation est écrasé par le chargement →
 *    ticket à demi-largeur ; il se pose APRÈS chaque chargement ;
 *  - sans `PRINT_WINDOW_CSS`, barre de défilement + marges du gabarit rognent
 *    le bord droit du ticket.
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
  probe?: RenderProbe;
  artifacts?: { htmlPath: string | null; pngPath: string | null; pdfPath: string | null; pdfBytes: number };
}> {
  let win: BrowserWindow | null = null;
  let tmpHtml: string | null = null;
  let pngPath: string | null = null;
  const t0 = Date.now();
  const render = computeRenderGeometry(paperWidthMm);
  try {
    win = new BrowserWindow({
      show: false,
      // Largeur en POINTS IMPRIMANTE (203 dpi) ; le zoom ramène le viewport CSS
      // à la largeur imprimable en mm attendue par le gabarit. Le texte est
      // rasterisé nativement à 203 dpi (net), pas agrandi depuis 96 dpi.
      width: render.deviceWidthPx,
      height: 1200,
      useContentSize: true,
      frame: false,
      skipTaskbar: true,
      focusable: false,
      paintWhenInitiallyHidden: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        // Rasterisation HORS ÉCRAN (OSR) : rend sans surface d'affichage et
        // sans voler le focus de la caisse pendant une vente.
        offscreen: true,
      },
    });
    const t1 = Date.now();
    // ── Fichier temporaire plutôt qu'URL `data:` ─────────────────────────
    // Une URL `data:` porte tout le ticket (logo base64 compris) dans la barre
    // d'adresse : elle est soumise aux limites de longueur et aux politiques de
    // navigation de Chromium. Une navigation `data:` tronquée ou refusée donne
    // un document VIDE. `loadFile` supprime cette classe entière de défaillance.
    tmpHtml = path.join(
      os.tmpdir(),
      `poscaisse-ticket-${Date.now()}-${Math.round(process.hrtime()[1] % 1e6)}.html`,
    );
    fs.writeFileSync(tmpHtml, html, 'utf-8');
    // Chargement + PREUVE de contenu ; zoom et CSS rejoués après CHAQUE load.
    const probe = await loadAndProve(win, tmpHtml, async () => {
      win!.webContents.setZoomFactor(render.zoomFactor);
      await win!.webContents.insertCSS(PRINT_WINDOW_CSS);
    });
    const geometry = computePageGeometry(probe.h, paperWidthMm);

    // Fenêtre redimensionnée à la hauteur RÉELLE du ticket, en points
    // imprimante : la capture porte sur le document entier.
    const bitmapHeightPx = computeBitmapHeightPx(probe.h);
    try {
      win.setContentSize(render.deviceWidthPx, bitmapHeightPx);
    } catch { /* redimensionnement best-effort */ }
    await new Promise((resolve) => setTimeout(resolve, RENDER_SETTLE_MS));

    // TROIS artefacts sur le Bureau AVANT toute impression.
    const artifacts = await writeDiagnosticArtifacts(win, html, geometry);

    // ── REFUS D'IMPRIMER UN DOCUMENT VIDE ────────────────────────────────
    // C'est ce job nul qui provoquait 1 mm de papier puis la coupe. Mieux vaut
    // un échec explicite et traçable qu'un ticket fantôme.
    if (probe.textLen === 0 || probe.h === 0) {
      // eslint-disable-next-line no-console
      console.error('[PERIPH] IMPRESSION ANNULÉE — document vide', JSON.stringify(probe));
      return {
        ok: false,
        error:
          'Document vide au moment de l’impression (aucun texte peint). ' +
          'Job NON envoyé — c’est ce job nul qui produisait 1 mm de papier puis la coupe.',
        probe,
        geometry,
        artifacts,
      };
    }

    const image = await win.webContents.capturePage();
    if (image.isEmpty()) {
      return { ok: false, error: 'rendu du ticket vide (capture hors écran)', probe, geometry, artifacts };
    }
    const png = image.toPNG();
    if (!png || png.length === 0) {
      return { ok: false, error: 'rendu du ticket illisible (PNG vide)', probe, geometry, artifacts };
    }
    pngPath = path.join(os.tmpdir(), `poscaisse-ticket-${Date.now()}.png`);
    fs.writeFileSync(pngPath, png);

    // Aperçu : preuve directe de CE QUI a été rasterisé.
    const previewDataUrl = await capturePreview(image);
    const t2 = Date.now();

    const target = deviceName || '';
    const optionsUsed: PrintOptionsUsed = {
      deviceName: deviceName ?? null,
      pageSize: `${render.printableMm}mm @ ${STAR_DPI}dpi → ${render.deviceWidthPx}x${bitmapHeightPx}px (bitmap GDI)`,
      margins: 'none',
      printBackground: true,
    };
    // Sans imprimante nommée : échec explicite. L'imprimante par défaut de
    // Windows peut être la file TIROIR (mesuré sur la caisse) — un envoi à
    // l'aveugle ouvrirait le tiroir sans jamais imprimer.
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
        htmlBytes: html.length,
        scrollHeightPx: geometry.scrollHeightPx,
        docScrollWidth: probe.docScrollWidth,
        docScrollHeight: probe.docScrollHeight,
        bodyScrollWidth: probe.bodyScrollWidth,
        bodyScrollHeight: probe.bodyScrollHeight,
        textLen: probe.textLen,
        imgs: probe.imgs,
        imgsDecoded: probe.imgsDecoded,
        readyState: probe.readyState,
        loader: 'loadFile',
        deviceWidthPx: render.deviceWidthPx,
        bitmapHeightPx,
        pngBytes: png.length,
        htmlPath: artifacts.htmlPath,
        pngPath: artifacts.pngPath,
        pdfPath: artifacts.pdfPath,
        pdfBytes: artifacts.pdfBytes,
        pageWidthMicrons: geometry.pageWidthMicrons,
        pageHeightMicrons: geometry.pageHeightMicrons,
        heightClamped: geometry.clamped,
        previewCaptured: !!previewDataUrl,
        ...timings,
        ok: result.ok,
        error: result.error,
      }),
    );
    return { ...result, timings, optionsUsed, geometry, previewDataUrl, probe, artifacts };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'print error' };
  } finally {
    win?.destroy();
    if (tmpHtml) {
      try { fs.unlinkSync(tmpHtml); } catch { /* nettoyage best-effort */ }
    }
    if (pngPath) {
      try {
        fs.unlinkSync(pngPath);
      } catch {
        /* nettoyage best-effort */
      }
    }
  }
}

/**
 * DIAGNOSTIC DÉCISIF — rend le MÊME document en PDF, par le MÊME pipeline de
 * mise en page Chromium, et l'écrit sur le disque.
 *
 * `printToPDF` emprunte la même pagination que le rendu et produit un fichier
 * INSPECTABLE. Cela partitionne le problème sans ambiguïté :
 *   - PDF correct (ticket lisible, bonne hauteur) → Chromium compose bien ;
 *     la panne est dans la remise GDI au pilote Star ;
 *   - PDF vide ou de hauteur nulle → la panne est en amont, dans le rendu.
 */
export async function renderDiagnosticPdf(
  html: string,
  paperWidthMm = 80,
): Promise<{ ok: boolean; filePath?: string; bytes?: number; probe?: RenderProbe; error?: string }> {
  let win: BrowserWindow | null = null;
  let tmpHtml: string | null = null;
  try {
    win = new BrowserWindow({
      // Même règle que l'impression : `show:false` charge et compose ; un
      // positionnement à -32000 fait échouer `loadFile` (ERR_FAILED).
      show: false,
      width: paperWidthToPx(paperWidthMm),
      height: 1200,
      frame: false,
      skipTaskbar: true,
      focusable: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    win.setIgnoreMouseEvents(true);
    tmpHtml = path.join(os.tmpdir(), `poscaisse-pdf-${Date.now()}.html`);
    fs.writeFileSync(tmpHtml, html, 'utf-8');
    const probe = await loadAndProve(win, tmpHtml);
    const geometry = computePageGeometry(probe.h, paperWidthMm);
    if (probe.textLen === 0 || probe.h === 0) {
      return {
        ok: false,
        probe,
        error: `Document vide avant génération PDF (textLen=${probe.textLen}, h=${probe.h}).`,
      };
    }
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      // Microns → pouces (printToPDF attend des pouces).
      pageSize: {
        width: geometry.pageWidthMicrons / 25400,
        height: geometry.pageHeightMicrons / 25400,
      },
    });
    // Un PDF de 0 octet n'est PAS un succès : on le dit au lieu d'écrire un
    // fichier vide que l'opérateur croira exploitable.
    if (!pdf || pdf.length < 1000) {
      return {
        ok: false,
        probe,
        error: `printToPDF a renvoyé ${pdf ? pdf.length : 0} octet(s) — Chromium n’a rien composé.`,
      };
    }
    const filePath = path.join(os.tmpdir(), `ticket-diagnostic-${Date.now()}.pdf`);
    fs.writeFileSync(filePath, pdf);
    // eslint-disable-next-line no-console
    console.info(
      '[PERIPH] PDF diagnostic',
      JSON.stringify({ filePath, bytes: pdf.length, ...probe, ...geometry }),
    );
    return { ok: true, filePath, bytes: pdf.length, probe };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'printToPDF error' };
  } finally {
    win?.destroy();
    if (tmpHtml) { try { fs.unlinkSync(tmpHtml); } catch { /* best-effort */ } }
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

  // Génère le PDF diagnostic et l'OUVRE dans la visionneuse Windows : le
  // caissier voit immédiatement ce que Chromium a composé.
  ipcMain.handle('pos-print:diagnosticPdf', async (_e, html: unknown, paperWidthMm?: unknown) => {
    if (typeof html !== 'string' || html.length === 0 || html.length > 500_000) {
      return { ok: false, error: 'invalid html payload' };
    }
    const width = paperWidthMm === 58 || paperWidthMm === 80 ? paperWidthMm : 80;
    const res = await renderDiagnosticPdf(html, width);
    if (res.ok && res.filePath) {
      try { await shell.openPath(res.filePath); } catch { /* ouverture best-effort */ }
    }
    return res;
  });

  ipcMain.handle(
    'pos-print:printHtml',
    async (
      _event,
      html: unknown,
      deviceName?: unknown,
      paperWidthMm?: unknown,
      // Accepté pour compatibilité avec l'écran diagnostic : le format de page
      // n'existe plus dans la voie GDI (le bitmap EST la page), il est ignoré.
      _forcePageSize?: unknown,
    ) => {
      if (typeof html !== 'string' || html.length === 0 || html.length > 500_000) {
        return { ok: false, error: 'invalid html payload' };
      }
      const device = typeof deviceName === 'string' && deviceName ? deviceName : undefined;
      const width = paperWidthMm === 58 || paperWidthMm === 80 ? paperWidthMm : 80;
      return printHtmlSilently(html, device, width);
    },
  );
}
