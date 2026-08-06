import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * PR #33 — impression ticket desktop réelle via le spooler OS.
 * Invariants : impression silencieuse honnête (échec → ok:false, jamais de faux
 * succès), IPC borné à deux canaux, payload validé, exposition preload étroite,
 * renderer câblé sur le nouveau canal (l'ancien chemin ESC/POS mort a disparu).
 */

// NOTE: buildReceiptPrintOptions importe 'electron' transitirement — on teste
// les invariants au niveau source (le module main n'est pas chargeable sous vitest).
const mainSrc = readFileSync(join(__dirname, 'posPrinting.ts'), 'utf8');
const indexSrc = readFileSync(join(__dirname, 'index.ts'), 'utf8');
const preloadSrc = readFileSync(join(__dirname, 'preload.ts'), 'utf8');
const bridgeSrc = readFileSync(join(__dirname, '..', 'renderer', 'services', 'peripheralBridge.ts'), 'utf8');

describe('posPrinting (main) — honest silent print', () => {
  /**
   * MESURÉ SUR LA CAISSE (2026-08-04) : `webContents.print()` ne remet AUCUNE
   * opération de dessin au pilote Star TSP143 (61 octets, 0 % d'encre, coupe
   * immédiate) tout en répondant `success` — c'est le « petit bout de papier ».
   * Ce chemin est donc INTERDIT pour le ticket ; il ne doit jamais revenir.
   */
  it('le ticket ne passe PLUS par webContents.print (61 octets, zéro encre sur la Star)', () => {
    // On retire commentaires de bloc et de ligne : la cause racine est
    // DOCUMENTÉE dans le code, seul un APPEL réel doit faire échouer ce test.
    const code = mainSrc
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    expect(code).not.toMatch(/webContents\.print\(/);
    expect(code).toMatch(/printPngViaGdi/);
  });

  it('rendu HORS ÉCRAN : offscreen obligatoire (show:false seul bloque, hors écran rend vide)', () => {
    expect(mainSrc).toMatch(/offscreen: true/);
    // Les deux pièges mesurés doivent rester documentés dans le code.
    expect(mainSrc).toMatch(/capturePage\(\)/);
    expect(mainSrc).not.toMatch(/x: -20000/);
  });

  it('une capture vide est un ÉCHEC honnête, jamais un ticket fantôme', () => {
    expect(mainSrc).toMatch(/image\.isEmpty\(\)[\s\S]{0,120}ok: false/);
    expect(mainSrc).toMatch(/png\.length === 0[\s\S]{0,120}ok: false/);
    expect(mainSrc).toMatch(/catch \(e: any\) \{\s*\n\s*return \{ ok: false/);
  });

  it('sans imprimante nommée : échec explicite, aucun envoi à l’aveugle', () => {
    expect(mainSrc).toMatch(/aucune imprimante sélectionnée pour le ticket/);
  });

  it('the html payload is validated (type, non-empty, bounded)', () => {
    expect(mainSrc).toMatch(/typeof html !== 'string' \|\| html\.length === 0 \|\| html\.length > 500_000/);
  });

  it('the hidden print window is sandboxed and always destroyed', () => {
    expect(mainSrc).toMatch(/sandbox: true/);
    expect(mainSrc).toMatch(/finally \{\s*\n\s*win\?\.destroy\(\)/);
  });

  it('le PNG temporaire est toujours nettoyé', () => {
    expect(mainSrc).toMatch(/fs\.unlinkSync\(pngPath\)/);
  });

  it('IPC is registered at app start', () => {
    expect(indexSrc).toMatch(/registerPosPrintingIpc\(\)/);
  });
});

describe('preload — narrow electronAPI exposure', () => {
  it('exposes ONLY getPrinters + printTicketHtml (no fs/shell/raw ipc)', () => {
    const block = preloadSrc.slice(preloadSrc.indexOf("exposeInMainWorld('electronAPI'"));
    expect(block).toMatch(/getPrinters: \(\) => ipcRenderer\.invoke\('pos-print:getPrinters'\)/);
    // Signature élargie à `paperWidthMm` (format de page explicite) — l'API
    // reste étroite : trois arguments de données, aucun accès système.
    expect(block).toMatch(/printTicketHtml: \(html: string, deviceName\?: string, paperWidthMm\?: 58 \| 80\)/);
    expect(block).not.toMatch(/require|shell|fs\.|exec/);
  });
});

describe('peripheralBridge — desktop print wired on the new channel', () => {
  it('printThermalUSB uses printTicketHtml and honours the honest-fallback rule', () => {
    expect(bridgeSrc).toMatch(/electronAPI\?\.printTicketHtml/);
    expect(bridgeSrc).toMatch(/result\?\.ok/);
    // failure → guarded fallback only (no unconditional dialog)
    expect(bridgeSrc).toMatch(/Desktop OS print failed[\s\S]{0,120}allowBrowserFallback \? this\.printBrowserFallback\(data\) : false/);
  });

  it('the dead ESC/POS electronAPI.printTicket branch is gone', () => {
    expect(bridgeSrc).not.toMatch(/electronAPI\?\.printTicket\b/);
    expect(bridgeSrc).not.toMatch(/electronAPI\.printTicket\(escPosCommands\)/);
  });

  it('the receipt HTML is serialized from the SAFE DOM builder (escaped values)', () => {
    expect(bridgeSrc).toMatch(/createHTMLDocument\('ticket'\)/);
    expect(bridgeSrc).toMatch(/this\.buildReceiptDOM\(doc, data\)/);
  });
});
