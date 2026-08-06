import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * PREUVE TERRAIN DÉCISIVE : le PDF de diagnostic est sorti à 0 OCTET, y compris
 * via « Microsoft Print to PDF ». Chromium composait donc un document VIDE bien
 * avant toute imprimante — la Star était hors de cause depuis le début, et le
 * « 1 mm puis coupe » n'était que la conséquence d'un job nul.
 *
 * Ces gardes verrouillent trois choses :
 *  1. la règle @page invalide qui perturbait la pagination est supprimée ;
 *  2. le chargement est PROUVÉ (contenu peint) avec un réessai ;
 *  3. aucun job n'est envoyé, et aucun PDF vide n'est écrit, sur un document nul.
 */
const main = readFileSync(join(__dirname, 'posPrinting.ts'), 'utf8');
const bridge = readFileSync(
  join(__dirname, '..', 'renderer', 'services', 'peripheralBridge.ts'),
  'utf8',
);

describe('règle @page valide', () => {
  it('plus de `size: <length> auto` (déclaration CSS invalide)', () => {
    expect(bridge).not.toMatch(/@page \{ size:.*auto/);
  });

  it('les marges nulles sont conservées', () => {
    expect(bridge).toMatch(/@page \{ margin: 0; \}/);
  });
});

describe('chargement prouvé avant impression', () => {
  it('attend la fin de chargement réelle, pas seulement la promesse', () => {
    expect(main).toMatch(/win\.webContents\.isLoading\(\)/);
    expect(main).toMatch(/once\('did-stop-loading'/);
  });

  it('réessaie une fois quand le document est vide', () => {
    expect(main).toMatch(/for \(let attempt = 1; attempt <= 2; attempt\+\+\)/);
  });

  it('l’attente de chargement est bornée (jamais de caisse figée)', () => {
    expect(main).toMatch(/setTimeout\(done, RENDER_READY_TIMEOUT_MS\)/);
  });
});

describe('refus d’imprimer un document vide', () => {
  it('aucun job envoyé si le document ne porte aucun texte', () => {
    expect(main).toMatch(/IMPRESSION ANNULÉE — document vide/);
    expect(main).toMatch(/probe\.textLen === 0 \|\| probe\.h === 0/);
  });

  it('le refus est explicite et explique le 1 mm', () => {
    expect(main).toMatch(/1 mm de papier puis la coupe/);
  });

  it('le refus a lieu AVANT la remise GDI au pilote', () => {
    const guard = main.indexOf('IMPRESSION ANNULÉE');
    const print = main.indexOf('printPngViaGdi(pngPath, target)');
    expect(guard).toBeGreaterThan(-1);
    expect(print).toBeGreaterThan(guard);
  });
});

describe('aucun PDF vide écrit sur le disque', () => {
  it('un PDF sous 1 Ko est signalé comme échec, pas écrit', () => {
    expect(main).toMatch(/pdf\.length < 1000/);
    expect(main).toMatch(/n’a rien composé/);
  });

  it('le contrôle précède l’écriture du fichier', () => {
    const check = main.indexOf('pdf.length < 1000');
    const write = main.indexOf('fs.writeFileSync(filePath, pdf)');
    expect(check).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(check);
  });
});
