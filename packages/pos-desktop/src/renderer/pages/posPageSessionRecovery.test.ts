import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Récupération de session câblée dans le SHELL WINDOWS (POSPage).
 *
 * Le bug terrain : après le retour de Neon, la caisse Windows restait bloquée
 * « SESSION NON OUVERTE » car les contrôles de récupération (CashOpenModal +
 * SessionReopenPrompt + watcher) n'étaient rendus QUE dans IPadPOSLayout. Le
 * layout desktop appliquait la garde d'encaissement sans offrir le moyen de
 * rouvrir. Ces assertions de source verrouillent le câblage desktop et
 * garantissent que la GARDE FISCALE n'est pas retirée.
 */
const src = readFileSync(join(__dirname, 'POSPage.tsx'), 'utf8');

describe('POSPage (shell Windows) — récupération de session câblée', () => {
  it('importe les contrôles de récupération + le watcher', () => {
    expect(src).toMatch(/import\s*\{\s*CashOpenModal\s*\}\s*from\s*'\.\.\/components\/pos\/CashOpenModal'/);
    expect(src).toMatch(/import\s*\{\s*SessionReopenPrompt\s*\}\s*from\s*'\.\.\/components\/pos\/SessionReopenPrompt'/);
    expect(src).toMatch(/import\s*\{\s*initSessionReopenWatcher\s*\}\s*from\s*'\.\.\/services\/sessionReopen'/);
  });

  it('initialise le watcher au niveau partagé (avant le split de layout)', () => {
    expect(src).toMatch(/initSessionReopenWatcher\(\)/);
    // Le watcher est appelé dans un effet monté une seule fois.
    expect(src).toMatch(/useEffect\(\(\)\s*=>\s*\{\s*initSessionReopenWatcher\(\);?\s*\}\s*,\s*\[\]\)/);
  });

  it('rend RÉELLEMENT CashOpenModal et SessionReopenPrompt sur le layout desktop', () => {
    expect(src).toMatch(/<CashOpenModal\s*\/>/);
    expect(src).toMatch(/<SessionReopenPrompt\s*\/>/);
  });

  it('la GARDE FISCALE d\'encaissement reste intacte (aucune vente sans session)', () => {
    // La garde bloque le paiement tant que l'ouverture a échoué et qu'aucune
    // session n'est présente — elle NE DOIT PAS être supprimée par ce correctif.
    expect(src).toMatch(/store\.posSessionOpenFailed\s*&&\s*!store\.posSession\?\.id/);
    expect(src).toMatch(/encaissement impossible/i);
  });

  it('le layout iPad garde son propre rendu (pas de régression)', () => {
    expect(src).toMatch(/if\s*\(device\.isIPad\)/);
    expect(src).toMatch(/<IPadPOSLayout\s*\/>/);
  });
});
