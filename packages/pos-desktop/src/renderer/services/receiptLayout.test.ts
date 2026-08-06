import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * TICKET BLANC sur Star TSP143 — cause mesurée, pas supposée.
 *
 * `webContents.print()` compose sur la page du PILOTE Windows, pas sur le
 * `@page { size: 80mm auto }` de la feuille de style. Tant que le corps du
 * ticket était centré (`margin: 3mm auto`), sa position dépendait de la largeur
 * de cette page :
 *
 *   page  80 mm → contenu de  4 mm à  76 mm → imprimé
 *   page 210 mm → contenu de 69 mm à 141 mm → 3 mm visibles sur 72 → blanc
 *   page 216 mm → contenu de 72 mm à 144 mm → rien → blanc
 *
 * (mesures obtenues en rendant le ticket sous Chromium à ces trois largeurs).
 * Aligné à gauche, le contenu démarre à 3 mm à TOUTE largeur de page.
 *
 * Ces tests interdisent le retour du centrage du CORPS. Le centrage INTERNE
 * (logo, QR, lignes `.center`) reste voulu : il est relatif au corps, pas à la
 * page.
 */
const bridgeSrc = readFileSync(join(__dirname, 'peripheralBridge.ts'), 'utf8');

/**
 * La règle CSS `body { … }` de la feuille du ticket.
 *
 * Extraction par LIGNE : la règle contient des interpolations `${…}` dont les
 * accolades fermantes piègent tout regex du type `[^}]*`.
 */
function bodyRule(): string {
  const line = bridgeSrc
    .split('\n')
    .find((l) => /^\s*body \{ font-family:/.test(l));
  if (!line) throw new Error('règle body du ticket introuvable');
  return line;
}

describe('mise en page du ticket — jamais centrée sur la page', () => {
  it('le corps du ticket n’est PAS centré (aucun `margin: … auto`)', () => {
    expect(bodyRule()).not.toMatch(/margin:[^;]*auto/);
  });

  it('le corps garde une marge fixe (contenu jamais collé au bord)', () => {
    expect(bodyRule()).toMatch(/margin:\s*3mm\s*;/);
  });

  it('le corps garde une largeur explicite (58 → 48 mm, 80 → 72 mm)', () => {
    expect(bodyRule()).toMatch(/width:\s*\$\{bodyMm\}mm/);
    expect(bridgeSrc).toMatch(/const bodyMm = width === 58 \? 48 : 72/);
  });

  it('html est remis à zéro (aucune marge héritée du navigateur)', () => {
    expect(bridgeSrc).toMatch(/html \{ margin: 0; padding: 0; \}/);
  });

  it('la raison est documentée dans le code (non-régression pour le prochain)', () => {
    expect(bridgeSrc).toMatch(/ALIGNÉ À GAUCHE, jamais centré/);
  });
});

describe('non-régression : le centrage INTERNE reste intact', () => {
  it('le logo reste centré dans le corps', () => {
    expect(bridgeSrc).toMatch(/\.logo \{[^}]*margin: 0 auto 2mm/);
  });

  it('le QR reste centré dans le corps', () => {
    expect(bridgeSrc).toMatch(/\.qr \{[^}]*margin: 2mm auto 1mm/);
  });

  it('la classe .center reste disponible pour l’en-tête', () => {
    expect(bridgeSrc).toMatch(/\.center \{ text-align: center; \}/);
  });

  it('@page ne porte plus que des marges nulles (plus de `size` invalide)', () => {
    expect(bridgeSrc).toMatch(/@page \{ margin: 0; \}/);
    expect(bridgeSrc).not.toMatch(/@page \{ size:/);
  });
});
