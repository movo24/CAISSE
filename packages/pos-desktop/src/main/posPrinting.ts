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
import { BrowserWindow, ipcMain, shell } from 'electron';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

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

/**
 * Charge le document ET garantit qu'il porte réellement du contenu peint.
 *
 * Le PDF de diagnostic est sorti à 0 OCTET sur le terrain : Chromium composait
 * donc un document vide bien avant toute imprimante. `loadFile()` résout sur
 * `did-finish-load`, ce qui ne garantit ni la peinture ni même un DOM peuplé.
 * On attend donc la fin de chargement RÉELLE (`isLoading()` faux), puis la
 * sonde de rendu ; si le document est vide, on RECHARGE une fois avant de
 * renoncer. Aucun job n'est envoyé sur un document vide.
 */
async function loadAndProve(
  win: BrowserWindow,
  filePath: string,
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
export interface RenderProbe {
  /** Hauteur retenue pour dimensionner la page (max des mesures). */
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
    return empty; /* rendu non sondable → on imprime quand même */
  }
}

/**
 * Options d'impression. `pageSize` EXPLICITE : on ne dépend plus du format par
 * défaut du pilote. Marges à zéro, fond imprimé, imprimante nommée exactement.
 */
export function buildReceiptPrintOptions(
  deviceName?: string,
  geometry?: PageGeometry,
  forcePageSize = true,
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
 *   ticket-<t>.png   la fenêtre réellement peinte (ce que Chromium voit)
 *   ticket-<t>.pdf   la composition Chromium (ce qui part au pilote)
 * HTML correct + PNG vide  → le rendu ne se fait pas.
 * PNG correct + PDF vide   → la composition d'impression échoue.
 * PDF correct + papier nul → le pilote Windows est en cause.
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
  forcePageSize = true,
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
  const t0 = Date.now();
  try {
    win = new BrowserWindow({
      // Fenêtre NON affichée. Mesuré sous Electron 28 réel : `show:false`
      // charge le document et produit une capture (136 ko) et un PDF (131 ko)
      // parfaitement valides — `paintWhenInitiallyHidden` vaut true par défaut.
      //
      // La positionner hors écran à -32000 (tentative de la 1.8.16) fait au
      // contraire ÉCHOUER le chargement : `ERR_FAILED (-2)` sur `loadFile`,
      // donc document vide, donc quelques millimètres de papier puis coupe.
      // Ne jamais y revenir.
      show: false,
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
    // ── Fichier temporaire plutôt qu'URL `data:` ─────────────────────────
    // Une URL `data:` porte tout le ticket (logo base64 compris) dans la barre
    // d'adresse : elle est soumise aux limites de longueur et aux politiques de
    // navigation de Chromium. Une navigation `data:` tronquée ou refusée donne
    // un document VIDE — donc une page de hauteur nulle, donc 1 mm de papier
    // puis coupe. `loadFile` supprime cette classe entière de défaillance.
    tmpHtml = path.join(
      os.tmpdir(),
      `poscaisse-ticket-${Date.now()}-${Math.round(process.hrtime()[1] % 1e6)}.html`,
    );
    fs.writeFileSync(tmpHtml, html, 'utf-8');
    // Chargement + PREUVE que le document porte du contenu (réessai inclus).
    const probe = await loadAndProve(win, tmpHtml);
    const geometry = computePageGeometry(probe.h, paperWidthMm);

    // Fenêtre redimensionnée à la hauteur RÉELLE du ticket : la capture PNG et
    // la composition d'impression portent alors sur le document entier, pas sur
    // la portion visible d'une fenêtre de hauteur arbitraire.
    try {
      win.setContentSize(paperWidthToPx(paperWidthMm), Math.max(200, Math.ceil(probe.h) + 20));
    } catch { /* redimensionnement best-effort */ }

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
        htmlBytes: html.length,
        scrollHeightPx: geometry.scrollHeightPx,
        docScrollWidth: probe.docScrollWidth,
        docScrollHeight: probe.docScrollHeight,
        bodyScrollWidth: probe.bodyScrollWidth,
        bodyScrollHeight: probe.bodyScrollHeight,
        windowWidthPx: paperWidthToPx(paperWidthMm),
        windowHeightPx: Math.max(200, Math.ceil(probe.h) + 20),
        textLen: probe.textLen,
        imgs: probe.imgs,
        imgsDecoded: probe.imgsDecoded,
        readyState: probe.readyState,
        loader: 'loadFile',
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
  }
}

/**
 * DIAGNOSTIC DÉCISIF — rend le MÊME document en PDF, par le MÊME pipeline de
 * mise en page Chromium, et l'écrit sur le disque.
 *
 * `webContents.print()` est une boîte noire : on ne voit jamais ce que Chromium
 * a réellement composé. `printToPDF` emprunte la même pagination mais produit
 * un fichier INSPECTABLE. Cela partitionne le problème sans ambiguïté :
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
      forcePageSize?: unknown,
    ) => {
      if (typeof html !== 'string' || html.length === 0 || html.length > 500_000) {
        return { ok: false, error: 'invalid html payload' };
      }
      const device = typeof deviceName === 'string' && deviceName ? deviceName : undefined;
      const width = paperWidthMm === 58 || paperWidthMm === 80 ? paperWidthMm : 80;
      return printHtmlSilently(html, device, width, forcePageSize !== false);
    },
  );
}
