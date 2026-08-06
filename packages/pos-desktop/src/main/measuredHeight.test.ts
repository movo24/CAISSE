import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computePageGeometry, MICRONS_PER_CSS_PX } from './posPrinting';

/**
 * DEUX CAUSES TROUVÉES PAR EXÉCUTION RÉELLE (Electron 28.3.3, banc local).
 *
 * 1. La hauteur mesurée était celle de la FENÊTRE, pas du contenu.
 *    `document.documentElement.scrollHeight` vaut TOUJOURS au moins la hauteur
 *    du viewport. Mesures du banc, ticket réel de 481 px de contenu :
 *      fenêtre 1200 px → docScrollHeight 1200 → page 322,5 mm
 *      fenêtre  830 px → docScrollHeight  830 → page 224,6 mm
 *      contenu réel                        481 → page 132,3 mm  (attendu)
 *    Le `Math.max()` incluant documentElement retenait donc la fenêtre.
 *    PDF produit AVANT : MediaBox 80,1 × 322,7 mm — APRÈS : 80,1 × 132,3 mm.
 *
 * 2. La fenêtre positionnée à x/y = -32000 (introduite en 1.8.16) fait ÉCHOUER
 *    le chargement : `ERR_FAILED (-2)` sur `loadFile`. Document vide, donc
 *    quelques millimètres de papier puis coupe. `show: false` charge et compose
 *    correctement (capture 129 ko, PDF 131 ko au banc).
 */
const src = readFileSync(join(__dirname, 'posPrinting.ts'), 'utf8');

describe('la hauteur mesurée est celle du CONTENU', () => {
  it('documentElement.scrollHeight n’entre PAS dans la hauteur retenue', () => {
    const probe = src.slice(src.indexOf('h: Math.max('), src.indexOf('docScrollWidth:'));
    expect(probe).not.toMatch(/d\.scrollHeight/);
  });

  it('la hauteur vient du bas réel du contenu', () => {
    expect(src).toMatch(/b \? Math\.ceil\(b\.getBoundingClientRect\(\)\.bottom\) : 0/);
  });

  it('docScrollHeight reste journalisé — pour diagnostic, jamais pour dimensionner', () => {
    expect(src).toMatch(/docScrollHeight: d \? d\.scrollHeight : 0/);
  });

  it('481 px de contenu donnent bien ~132 mm (valeur du banc)', () => {
    const g = computePageGeometry(481, 80);
    expect(g.pageHeightMicrons / 1000).toBeCloseTo(132.3, 1);
  });

  it('la hauteur de fenêtre n’influence plus la page (1200 px ≠ 322 mm)', () => {
    const contenu = computePageGeometry(481, 80).pageHeightMicrons;
    const fenetre = computePageGeometry(1200, 80).pageHeightMicrons;
    expect(contenu).toBeLessThan(fenetre);
    expect(contenu / 1000).toBeLessThan(140);
  });

  it('la conversion px→microns reste exacte', () => {
    expect(Math.round(481 * MICRONS_PER_CSS_PX) + 5000).toBe(computePageGeometry(481, 80).pageHeightMicrons);
  });
});

describe('la fenêtre de rendu charge réellement le document', () => {
  it('AUCUN positionnement hors écran extrême (ERR_FAILED prouvé au banc)', () => {
    expect(src).not.toMatch(/x: -32000/);
    expect(src).not.toMatch(/y: -32000/);
  });

  it('les deux fenêtres (impression et PDF) utilisent show:false', () => {
    expect(src.match(/^\s*show: false,$/gm)?.length).toBe(2);
    expect(src).not.toMatch(/^\s*show: true,$/m);
  });

  it('la raison est documentée pour ne pas y revenir', () => {
    expect(src).toMatch(/ERR_FAILED/);
  });
});
