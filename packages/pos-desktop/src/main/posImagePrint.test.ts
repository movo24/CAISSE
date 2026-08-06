import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CSS_DPI,
  MAX_BITMAP_HEIGHT_PX,
  MIN_BITMAP_HEIGHT_PX,
  STAR_DPI,
  computeBitmapHeightPx,
  computeRenderGeometry,
  printableWidthMm,
} from './posImagePrint';

/**
 * Impression ticket en IMAGE + GDI natif — remplace `webContents.print`, qui
 * n'émet aucune opération de dessin vers le pilote Star TSP143.
 *
 * Mesures terrain du 2026-08-04 (file Star capturée sur port fichier) :
 *   webContents.print .....    61 octets, 0,0 % d'encre  → bout de papier vide
 *   Bloc-notes (GDI)  ..... 21 679 octets, 19,9 % d'encre → texte imprimé
 *   image + GDI (ici) ..... 16 252 octets, 24,9 % d'encre → TICKET SORTI
 */

describe('géométrie de rendu — largeur physique exacte', () => {
  it('80 mm de rouleau => 72 mm imprimables (formulaire pilote « 72mm x Reçu »)', () => {
    expect(printableWidthMm(80)).toBe(72);
  });

  it('58 mm de rouleau => 48 mm imprimables (même règle que le gabarit du ticket)', () => {
    expect(printableWidthMm(58)).toBe(48);
  });

  it('le bitmap fait la largeur imprimable EXACTE en points 203 dpi', () => {
    const g = computeRenderGeometry(80);
    // 72 mm à 203 dpi = 72/25,4*203 = 575,4 -> 575 px
    expect(g.deviceWidthPx).toBe(575);
    expect(g.printableMm).toBe(72);
  });

  it('58 mm : 48 mm à 203 dpi = 384 px', () => {
    expect(computeRenderGeometry(58).deviceWidthPx).toBe(384);
  });

  it('le zoom ramène le viewport CSS à la largeur 96 dpi attendue par le gabarit', () => {
    const g = computeRenderGeometry(80);
    expect(g.zoomFactor).toBeCloseTo(STAR_DPI / CSS_DPI, 6);
    // 72 mm à 96 dpi = 272 px CSS : le ticket se compose comme en 72 mm...
    expect(g.cssWidthPx).toBe(272);
    // ...et le bitmap sort à 203 dpi (texte net, jamais un rendu 96 dpi agrandi).
    expect(Math.round(g.cssWidthPx * g.zoomFactor)).toBeCloseTo(g.deviceWidthPx, -1);
  });
});

describe('hauteur du bitmap — bornée, jamais dégénérée', () => {
  it('convertit la hauteur mesurée (px CSS) en points imprimante', () => {
    // 400 px CSS * 203/96 = 846 px
    expect(computeBitmapHeightPx(400)).toBe(846);
  });

  it('une hauteur nulle/absurde ne produit pas une page dégénérée', () => {
    expect(computeBitmapHeightPx(0)).toBe(MIN_BITMAP_HEIGHT_PX);
    expect(computeBitmapHeightPx(-5)).toBe(MIN_BITMAP_HEIGHT_PX);
    expect(computeBitmapHeightPx(Number.NaN)).toBe(MIN_BITMAP_HEIGHT_PX);
  });

  it('un ticket aberrant ne consomme pas un mètre de papier', () => {
    expect(computeBitmapHeightPx(999_999)).toBe(MAX_BITMAP_HEIGHT_PX);
  });
});

describe('remise au pilote — honnêteté et sécurité', () => {
  const src = readFileSync(join(__dirname, 'posImagePrint.ts'), 'utf8');

  it('les entrées passent par variables d’environnement (aucune injection shell)', () => {
    expect(src).toMatch(/POS_IMG_FILE: pngPath/);
    expect(src).toMatch(/POS_IMG_PRINTER: printerName/);
    expect(src).toMatch(/\$env:POS_IMG_FILE/);
    expect(src).toMatch(/\$env:POS_IMG_PRINTER/);
  });

  it('bitmap 1 bit/pixel : le pilote Star ne trame pas le texte thermique', () => {
    expect(src).toMatch(/Format1bppIndexed/);
  });

  it('1 pixel image = 1 point imprimante (largeur physique juste)', () => {
    expect(src).toMatch(/PageUnit = \[System\.Drawing\.GraphicsUnit\]::Pixel/);
    expect(src).toMatch(/OriginAtMargins = \$false/);
  });

  it('imprimante absente / hors Windows / délai : échec explicite, jamais un faux succès', () => {
    expect(src).toMatch(/impression GDI disponible uniquement sur Windows/);
    expect(src).toMatch(/aucune imprimante sélectionnée/);
    expect(src).toMatch(/imprimante introuvable/);
    expect(src).toMatch(/délai dépassé/);
  });

  it('la cause racine mesurée est consignée dans le module (61 octets, 0 % d’encre)', () => {
    expect(src).toMatch(/61 octets/);
    expect(src).toMatch(/1B 64 33/); // coupe partielle émise sans aucune encre
  });
});
