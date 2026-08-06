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

describe('format de page : dimensionné depuis la MESURE, plus depuis le pilote', () => {
  it('le pageSize explicite est imposé PAR DÉFAUT', () => {
    // Décision revue : le formulaire du pilote ne produisait qu'un moignon de
    // papier. La page est désormais dimensionnée sur la hauteur mesurée.
    expect(src).toMatch(/forcePageSize = true/);
    expect(src).toMatch(/\.\.\.\(forcePageSize && geometry/);
  });

  it('il reste désactivable explicitement depuis l’écran diagnostic', () => {
    expect(src).toMatch(/forcePageSize !== false/);
  });

  it('la géométrie mesurée reste journalisée même sans forçage', () => {
    for (const f of ['scrollHeightPx', 'pageWidthMicrons', 'pageHeightMicrons']) {
      expect(src).toContain(f);
    }
  });
});
