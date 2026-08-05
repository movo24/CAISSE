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
  it('elle est AFFICHÉE (une fenêtre show:false n’est jamais peinte)', () => {
    // Vise la PROPRIÉTÉ dans l'objet d'options, pas la prose du commentaire
    // (qui cite « show: false » pour expliquer la cause racine).
    expect(src).toMatch(/^\s*show: true,$/m);
    expect(src).not.toMatch(/^\s*show: false,$/m);
  });

  it('elle est positionnée hors écran (invisible pour le caissier)', () => {
    expect(src).toMatch(/x: -32000/);
    expect(src).toMatch(/y: -32000/);
  });

  it('le bridage d’arrière-plan est désactivé (sinon rendu throttlé → page vide)', () => {
    expect(src).toMatch(/backgroundThrottling: false/);
  });

  it('elle ne vole ni le focus ni la barre des tâches pendant une vente', () => {
    expect(src).toMatch(/skipTaskbar: true/);
    expect(src).toMatch(/focusable: false/);
    expect(src).toMatch(/setIgnoreMouseEvents\(true\)/);
  });

  it('elle reste TOUJOURS détruite (aucune fenêtre fantôme accumulée)', () => {
    expect(src).toMatch(/finally \{\s*\n\s*win\?\.destroy\(\)/);
  });
});

describe('format de page : le formulaire rouleau du pilote fait foi', () => {
  it('aucun pageSize imposé par défaut', () => {
    expect(src).toMatch(/forcePageSize = false/);
    expect(src).toMatch(/\.\.\.\(forcePageSize && geometry/);
  });

  it('le forçage reste possible, mais explicitement demandé', () => {
    expect(src).toMatch(/forcePageSize === true/);
  });

  it('la géométrie mesurée reste journalisée même sans forçage', () => {
    for (const f of ['scrollHeightPx', 'pageWidthMicrons', 'pageHeightMicrons']) {
      expect(src).toContain(f);
    }
  });
});
