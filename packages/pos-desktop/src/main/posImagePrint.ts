/**
 * Impression du ticket en IMAGE MONOCHROME via GDI natif (Windows).
 *
 * ── Pourquoi ce module existe (mesuré sur la caisse le 2026-08-04) ──
 * `webContents.print()` n'émet AUCUNE opération de dessin vers le pilote Star
 * TSP100/TSP143 (futurePRNT). Preuve : en capturant la sortie du pilote sur un
 * port fichier, un ticket complet produit exactement 61 octets —
 *
 *   1B 1F 70 00 · 1B 40 · 1B 30 · … · 1B 64 66 (avance) · 1B 64 33 (COUPE)
 *
 * soit en-tête + avance + coupe, ZÉRO bloc raster, 0 % d'encre — et Electron
 * répond pourtant `success = true`. D'où le « petit morceau de papier
 * inutilisable » sur le terrain. Le même pilote, alimenté par GDI (Bloc-notes),
 * produit 21 679 octets dont 19,9 % non nuls, avec blocs raster `1B 49`/`1B 58`.
 * Trois variantes de `@page` (80mm auto, aucune, 72mm×3002mm) donnent les MÊMES
 * 61 octets : ce n'est ni le CSS, ni le format papier, ni les marges.
 *
 * On abandonne donc `webContents.print` pour ce ticket : le document est
 * rasterisé par Chromium (rendu HORS ÉCRAN), converti en bitmap 1 bit/pixel,
 * puis remis au pilote par `System.Drawing.Printing` (GDI). Mesure de la voie
 * de remplacement sur la même file : 16 252 octets, 24,9 % d'encre, coupe
 * partielle en fin de job — et ticket physiquement sorti.
 *
 * HONNÊTETÉ : GDI confirme la REMISE au spouleur, jamais la sortie physique du
 * papier. Toute défaillance résout `{ ok:false, error }` — jamais un faux
 * succès. Aucune dépendance native : PowerShell + System.Drawing, comme
 * `posRawPrint.ts`.
 */
import { spawn } from 'child_process';

/** Résolution réelle de la tête thermique TSP100/TSP143. */
export const STAR_DPI = 203;

/** px CSS par pouce (référentiel de mise en page du navigateur). */
export const CSS_DPI = 96;

const GDI_PRINT_TIMEOUT_MS = 30_000;

/**
 * Largeur RÉELLEMENT imprimable selon la largeur de rouleau configurée.
 * Le rouleau 80 mm a une zone imprimable de 72 mm (formulaire pilote
 * « 72mm x Reçu », relevé sur la caisse) ; le 58 mm, 48 mm. Ces valeurs sont
 * celles déjà utilisées par le gabarit du ticket (`buildReceiptDOM`).
 */
export function printableWidthMm(paperWidthMm: number): number {
  return paperWidthMm === 58 ? 48 : 72;
}

/**
 * Géométrie de rendu hors écran. PURE et testée.
 *
 * On rend à la largeur physique EXACTE en points imprimante (203 dpi) tout en
 * conservant une mise en page en millimètres : la fenêtre fait
 * `deviceWidthPx` pixels et le zoom `zoomFactor` ramène la largeur CSS à la
 * valeur 96 dpi attendue par le gabarit. Résultat : texte net (pas
 * d'agrandissement d'un rendu 96 dpi) et largeur physique juste.
 */
export interface RenderGeometry {
  /** Largeur de la fenêtre / du bitmap, en points imprimante (203 dpi). */
  deviceWidthPx: number;
  /** Largeur du viewport CSS vue par le gabarit (96 dpi). */
  cssWidthPx: number;
  /** Facteur de zoom Chromium appliqué (203/96). */
  zoomFactor: number;
  /** Largeur imprimable retenue (mm). */
  printableMm: number;
}

export function computeRenderGeometry(paperWidthMm: number): RenderGeometry {
  const printableMm = printableWidthMm(paperWidthMm);
  const deviceWidthPx = Math.round((printableMm / 25.4) * STAR_DPI);
  const cssWidthPx = Math.round((printableMm / 25.4) * CSS_DPI);
  return {
    deviceWidthPx,
    cssWidthPx,
    zoomFactor: STAR_DPI / CSS_DPI,
    printableMm,
  };
}

/**
 * Hauteur du bitmap en points imprimante, depuis la hauteur mesurée en px CSS.
 * Bornée : ni page dégénérée (ticket perdu), ni mètre de papier gaspillé.
 */
export const MIN_BITMAP_HEIGHT_PX = 80; // ~10 mm
export const MAX_BITMAP_HEIGHT_PX = 12_000; // ~1,5 m

export function computeBitmapHeightPx(cssHeightPx: number): number {
  const px = Number.isFinite(cssHeightPx) && cssHeightPx > 0 ? cssHeightPx : 0;
  const scaled = Math.ceil(px * (STAR_DPI / CSS_DPI));
  return Math.min(MAX_BITMAP_HEIGHT_PX, Math.max(MIN_BITMAP_HEIGHT_PX, scaled));
}

/**
 * Script PowerShell d'impression GDI. Les entrées passent par VARIABLES
 * D'ENVIRONNEMENT (jamais par interpolation shell → aucune injection possible).
 * Le bitmap est aplati sur fond blanc puis converti en 1 bit/pixel : le pilote
 * Star ne trame plus, le texte thermique reste net. `PageUnit = Pixel` mappe
 * 1 pixel image sur 1 point imprimante → largeur physique exacte.
 */
const GDI_PRINT_PS = `
$ErrorActionPreference = "Stop"
try {
  Add-Type -AssemblyName System.Drawing
  $src = [System.Drawing.Bitmap]::FromFile($env:POS_IMG_FILE)
  $flat = New-Object System.Drawing.Bitmap($src.Width, $src.Height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g0 = [System.Drawing.Graphics]::FromImage($flat)
  $g0.Clear([System.Drawing.Color]::White)
  $g0.DrawImage($src, 0, 0, $src.Width, $src.Height)
  $g0.Dispose(); $src.Dispose()
  $mono = $flat.Clone((New-Object System.Drawing.Rectangle(0,0,$flat.Width,$flat.Height)), [System.Drawing.Imaging.PixelFormat]::Format1bppIndexed)
  $flat.Dispose()
  $doc = New-Object System.Drawing.Printing.PrintDocument
  $doc.PrinterSettings.PrinterName = $env:POS_IMG_PRINTER
  if (-not $doc.PrinterSettings.IsValid) { Write-Output "ERR:imprimante introuvable"; exit }
  $doc.DocumentName = "CAISSE TICKET"
  $doc.OriginAtMargins = $false
  $doc.add_PrintPage({
    param($s, $e)
    $e.Graphics.PageUnit = [System.Drawing.GraphicsUnit]::Pixel
    $e.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
    $e.Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
    $e.Graphics.DrawImage($mono, 0, 0, $mono.Width, $mono.Height)
    $e.HasMorePages = $false
  })
  $doc.Print()
  $doc.Dispose(); $mono.Dispose()
  Write-Output "OK"
} catch { Write-Output ("ERR:" + $_.Exception.Message) }
`;

/**
 * Remet un PNG au pilote Windows nommé, via GDI. Ne throw jamais.
 * Hors Windows → échec explicite (le ticket se pilote sur le poste réel).
 */
export function printPngViaGdi(
  pngPath: string,
  printerName: string,
): Promise<{ ok: boolean; error?: string; ms?: number }> {
  const t0 = Date.now();
  if (process.platform !== 'win32') {
    return Promise.resolve({ ok: false, error: 'impression GDI disponible uniquement sur Windows' });
  }
  if (!printerName) return Promise.resolve({ ok: false, error: 'aucune imprimante sélectionnée' });
  if (!pngPath) return Promise.resolve({ ok: false, error: 'aucune image à imprimer' });

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', GDI_PRINT_PS],
      { env: { ...process.env, POS_IMG_FILE: pngPath, POS_IMG_PRINTER: printerName } },
    );
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, error: 'impression GDI : délai dépassé', ms: Date.now() - t0 });
    }, GDI_PRINT_TIMEOUT_MS);

    child.stdout.on('data', (d) => (stdout += String(d)));
    child.stderr.on('data', (d) => (stderr += String(d)));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: e?.message || 'powershell spawn error', ms: Date.now() - t0 });
    });
    child.on('close', () => {
      clearTimeout(timer);
      const ms = Date.now() - t0;
      const out = stdout.trim();
      if (out.startsWith('OK')) return resolve({ ok: true, ms });
      const msg = out.startsWith('ERR:') ? out.slice(4) : out || stderr.trim() || 'impression GDI échouée';
      resolve({ ok: false, error: msg, ms });
    });
  });
}
