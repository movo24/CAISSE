import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * « Desktop OS print success » SANS papier — deux causes dans le chemin
 * d'impression lui-même, indépendantes de l'état de la file Windows :
 *
 *  1. le ticket embarque DEUX images en data-URL (logo + QR) ; `loadURL`
 *     résout sur `did-finish-load` et ne garantit pas leur décodage. Imprimer
 *     avant → ticket vide ou amputé, alors que Windows accepte le job ;
 *  2. le callback de `print()` signale la REMISE au spouleur, pas la fin de
 *     l'aspiration du document : détruire la fenêtre dans la foulée tronque
 *     le job.
 *
 * Le module main n'est pas chargeable sous vitest (import `electron`) — on
 * verrouille donc les invariants au niveau source, comme posPrinting.test.ts.
 */
const mainSrc = readFileSync(join(__dirname, 'posPrinting.ts'), 'utf8');
const bridgeSrc = readFileSync(
  join(__dirname, '..', 'renderer', 'services', 'peripheralBridge.ts'),
  'utf8',
);

describe('attente du rendu réel avant impression', () => {
  it('attend polices ET images décodées avant print()', () => {
    expect(mainSrc).toMatch(/await waitForRenderReadyAndMeasure\(win\)/);
    expect(mainSrc).toMatch(/document\.fonts\.ready/);
    expect(mainSrc).toMatch(/i\.decode\(\)/);
  });

  it('l’attente est BORNÉE (jamais de caisse figée sur un rendu qui ne vient pas)', () => {
    expect(mainSrc).toMatch(/RENDER_READY_TIMEOUT_MS\s*=\s*5_000/);
    expect(mainSrc).toMatch(/Promise\.race/);
  });

  it('une sonde de rendu qui échoue n’empêche PAS d’imprimer', () => {
    // La sonde retourne 0 (mesure inconnue) au lieu de throw : on imprime
    // quand même, avec une hauteur de page bornée au minimum.
    expect(mainSrc).toMatch(/return 0; \/\* rendu non sondable/);
  });

  it('l’attente a lieu APRÈS loadURL et AVANT print()', () => {
    const load = mainSrc.indexOf('await win.loadURL(');
    const ready = mainSrc.indexOf('await waitForRenderReadyAndMeasure(win)');
    const print = mainSrc.indexOf('win!.webContents.print(');
    expect(load).toBeGreaterThan(-1);
    expect(ready).toBeGreaterThan(load);
    expect(print).toBeGreaterThan(ready);
  });
});

describe('fin d’aspiration du spouleur avant destruction de la fenêtre', () => {
  it('laisse un délai au spouleur quand le job a été accepté', () => {
    expect(mainSrc).toMatch(/SPOOL_SETTLE_MS\s*=\s*1_500/);
    expect(mainSrc).toMatch(/if \(result\.ok\) \{[\s\S]*?SPOOL_SETTLE_MS/);
  });

  it('la fenêtre reste TOUJOURS détruite (aucune fuite de BrowserWindow)', () => {
    expect(mainSrc).toMatch(/finally \{\s*\n\s*win\?\.destroy\(\)/);
  });

  it('le délai n’est pas appliqué en cas d’échec (aucune latence inutile)', () => {
    const settle = mainSrc.indexOf('SPOOL_SETTLE_MS));');
    const guard = mainSrc.lastIndexOf('if (result.ok) {', settle);
    expect(guard).toBeGreaterThan(-1);
  });

  it('totalMs mesure APRÈS le délai (chronométrage honnête)', () => {
    expect(mainSrc).toMatch(/totalMs: Date\.now\(\) - t0/);
  });
});

describe('non-régression : honnêteté conservée', () => {
  it('aucun faux succès introduit — les échecs restent ok:false', () => {
    expect(mainSrc).toMatch(/\{ ok: false, error: 'print timeout' \}/);
    expect(mainSrc).toMatch(/failureReason \|\| 'print failed'/);
  });

  it('le renderer n’annonce jamais « imprimé », seulement la remise à la file', () => {
    expect(bridgeSrc).not.toMatch(/confirmée par Windows/);
  });
});
