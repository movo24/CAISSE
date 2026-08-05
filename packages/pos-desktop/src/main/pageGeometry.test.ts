import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  computePageGeometry,
  paperWidthToPx,
  MICRONS_PER_CSS_PX,
  PAGE_HEIGHT_SAFETY_MICRONS,
  MIN_PAGE_HEIGHT_MICRONS,
  MAX_PAGE_HEIGHT_MICRONS,
} from './posPrinting';

/**
 * FORMAT DE PAGE EXPLICITE — remplace `@page size: 80mm auto` et le format par
 * défaut du pilote Windows.
 *
 * `webContents.print()` n'honore pas le `@page` de la feuille de style : le
 * format vient du pilote. Sur une Star restée en Letter/A4, le ticket se perd
 * (page immense) ou se tronque (page courte) — d'où « petit bout de papier
 * blanc ». On impose donc largeur = rouleau, hauteur = mesure RÉELLE du
 * document (`scrollHeight`) convertie en microns.
 */

const mm = (microns: number) => microns / 1000;

describe('conversion px → microns', () => {
  it('1 px CSS = 25,4/96 mm (96 dpi)', () => {
    expect(MICRONS_PER_CSS_PX).toBeCloseTo(264.583, 2);
  });

  it('un ticket de 476 px (~126 mm) donne une page ~131 mm avec la marge', () => {
    const g = computePageGeometry(476, 80);
    expect(mm(g.pageHeightMicrons)).toBeGreaterThan(120);
    expect(mm(g.pageHeightMicrons)).toBeLessThan(135);
  });
});

describe('largeur imposée', () => {
  it('80 mm → 80 000 microns', () => {
    expect(computePageGeometry(400, 80).pageWidthMicrons).toBe(80_000);
  });

  it('58 mm → 58 000 microns', () => {
    expect(computePageGeometry(400, 58).pageWidthMicrons).toBe(58_000);
  });

  it('la fenêtre de rendu fait la largeur du rouleau (80 mm ≈ 302 px)', () => {
    expect(paperWidthToPx(80)).toBe(302);
    expect(paperWidthToPx(58)).toBe(219);
  });
});

describe('hauteur : marge de sécurité et bornes', () => {
  it('ajoute la marge de sécurité à la hauteur mesurée', () => {
    const g = computePageGeometry(100, 80);
    expect(g.pageHeightMicrons).toBe(Math.round(100 * MICRONS_PER_CSS_PX) + PAGE_HEIGHT_SAFETY_MICRONS);
    expect(g.clamped).toBe(false);
  });

  it('mesure absente (0) → hauteur MINIMALE, jamais une page dégénérée', () => {
    const g = computePageGeometry(0, 80);
    expect(g.pageHeightMicrons).toBe(MIN_PAGE_HEIGHT_MICRONS);
    expect(g.clamped).toBe(true);
  });

  it('mesure aberrante (négative / NaN) → bornée, jamais NaN transmis à Electron', () => {
    for (const bad of [-50, Number.NaN, Number.POSITIVE_INFINITY]) {
      const g = computePageGeometry(bad as number, 80);
      expect(Number.isFinite(g.pageHeightMicrons)).toBe(true);
      expect(g.pageHeightMicrons).toBeGreaterThanOrEqual(MIN_PAGE_HEIGHT_MICRONS);
    }
  });

  it('document démesuré → borné à 1,2 m (aucun mètre de papier gaspillé)', () => {
    const g = computePageGeometry(100_000, 80);
    expect(g.pageHeightMicrons).toBe(MAX_PAGE_HEIGHT_MICRONS);
    expect(g.clamped).toBe(true);
  });

  it('`clamped` signale une mesure suspecte (à afficher au diagnostic)', () => {
    expect(computePageGeometry(476, 80).clamped).toBe(false);
    expect(computePageGeometry(1, 80).clamped).toBe(true);
  });
});

describe('options réellement transmises à webContents.print', () => {
  const src = readFileSync(join(__dirname, 'posPrinting.ts'), 'utf8');

  it('pageSize EXPLICITE : plus de dépendance au format par défaut du pilote', () => {
    expect(src).toMatch(/pageSize: \{ width: geometry\.pageWidthMicrons, height: geometry\.pageHeightMicrons \}/);
  });

  it('marges à zéro et fond imprimé', () => {
    expect(src).toMatch(/marginType: 'none'/);
    expect(src).toMatch(/printBackground: true/);
  });

  it('nom exact de l’imprimante transmis quand il est connu', () => {
    expect(src).toMatch(/\.\.\.\(deviceName \? \{ deviceName \} : \{\}\)/);
  });

  it('attente : polices, décodage des images, puis DEUX cycles de rendu', () => {
    expect(src).toMatch(/document\.fonts\.ready/);
    expect(src).toMatch(/i\.decode\(\)/);
    expect(src).toMatch(/requestAnimationFrame\(\(\) => requestAnimationFrame\(r\)\)/);
  });

  it('la mesure est prise APRÈS l’attente de rendu', () => {
    const ready = src.indexOf('await waitForRenderReadyAndMeasure(win)');
    const geom = src.indexOf('computePageGeometry(probe.h, paperWidthMm)');
    const print = src.indexOf('win!.webContents.print(');
    expect(ready).toBeGreaterThan(-1);
    expect(geom).toBeGreaterThan(ready);
    expect(print).toBeGreaterThan(geom);
  });

  it('la fenêtre de rendu est dimensionnée à la largeur du rouleau', () => {
    expect(src).toMatch(/width: paperWidthToPx\(paperWidthMm\)/);
  });

  it('journalise scrollHeightPx, pageWidthMicrons, pageHeightMicrons', () => {
    for (const f of ['scrollHeightPx', 'pageWidthMicrons', 'pageHeightMicrons']) {
      expect(src).toContain(f);
    }
  });

  it('un aperçu de la fenêtre imprimée est capturé', () => {
    expect(src).toMatch(/capturePage\(\)/);
    expect(src).toMatch(/previewDataUrl/);
  });
});
