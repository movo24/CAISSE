import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * CAUSE RACINE du « petit bout de papier coupé aussitôt ».
 *
 * La page de test Windows sort ENTIÈRE et coupe à la fin : le pilote Star, son
 * formulaire rouleau et le massicot sont donc corrects, et la longueur de page
 * suit le contenu. Notre job ne produisait que quelques millimètres — donc le
 * document envoyé était vide de contenu PEINT.
 *
 * Une fenêtre `show: false` n'est pas composée par Chromium : aucune frame
 * n'est produite et `webContents.print()` sérialise un document sans rendu.
 * La fenêtre doit donc être réellement affichée — mais hors de l'espace de
 * travail, pour rester invisible du caissier.
 */
const src = readFileSync(join(__dirname, 'posPrinting.ts'), 'utf8');

describe('la fenêtre d’impression est réellement composée', () => {
  // HYPOTHÈSE RÉFUTÉE PAR L'EXÉCUTION (banc Electron 28.3.3 réel).
  // La 1.8.16 supposait qu'une fenêtre `show:false` n'était jamais peinte et
  // l'affichait hors écran à -32000. Le banc montre l'inverse :
  //   show:false          → charge, capture 129 ko, PDF 131 ko  ✔
  //   show:true à -32000  → ERR_FAILED (-2) sur loadFile, document VIDE  �’
  // C'est ce positionnement qui empêchait le chargement depuis la 1.8.16.
  it('elle N’EST PAS positionnée hors écran (ERR_FAILED prouvé au banc)', () => {
    expect(src).not.toMatch(/x: -32000/);
    expect(src).not.toMatch(/y: -32000/);
  });

  it('elle utilise show:false, qui charge et compose réellement', () => {
    expect(src).toMatch(/^\s*show: false,$/m);
    expect(src).not.toMatch(/^\s*show: true,$/m);
  });

  it('le bridage d’arrière-plan est désactivé (sinon rendu throttlé → page vide)', () => {
    expect(src).toMatch(/backgroundThrottling: false/);
  });

  it('elle ne vole ni le focus ni la barre des tâches pendant une vente', () => {
    expect(src).toMatch(/skipTaskbar: true/);
    expect(src).toMatch(/focusable: false/);
  });

  it('elle reste TOUJOURS détruite (aucune fenêtre fantôme accumulée)', () => {
    expect(src).toMatch(/finally \{\s*\n\s*win\?\.destroy\(\)/);
  });
});

describe('format de page : le bitmap EST la page (voie GDI)', () => {
  it('le document est dimensionné depuis la MESURE, en points imprimante', () => {
    // Plus aucun format de page pilote : le bitmap est rasterisé à la hauteur
    // mesurée du ticket et remis tel quel à GDI. Un formulaire mal réglé ne
    // peut plus tronquer le ticket.
    expect(src).toMatch(/computeBitmapHeightPx\(probe\.h\)/);
    expect(src).toMatch(/setContentSize\(render\.deviceWidthPx, bitmapHeightPx\)/);
  });

  it('l’ancien forçage de pageSize a DISPARU de bout en bout (aucun réglage mort)', () => {
    // Un réglage qui ne fait rien mais reste réglable est un piège de
    // diagnostic : il a été retiré du main, du preload, du renderer et de l'UI.
    // On retire les commentaires : le retrait est DOCUMENTÉ dans le code (pour
    // qu'il ne soit pas réintroduit), seul un usage réel doit faire échouer.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    expect(code).not.toMatch(/forcePageSize/i);
    expect(code).not.toMatch(/\.\.\.\(forcePageSize && geometry/);
  });

  it('la géométrie mesurée reste journalisée', () => {
    for (const f of ['scrollHeightPx', 'pageWidthMicrons', 'pageHeightMicrons']) {
      expect(src).toContain(f);
    }
  });
});
