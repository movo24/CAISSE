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
  it('print options are silent, no margins, optional device', () => {
    expect(mainSrc).toMatch(/silent: true/);
    expect(mainSrc).toMatch(/marginType: 'none'/);
  });

  it('failure paths resolve ok:false (timeout, failureReason, exception) — never a fake success', () => {
    expect(mainSrc).toMatch(/\{ ok: false, error: 'print timeout' \}/);
    expect(mainSrc).toMatch(/failureReason \|\| 'print failed'/);
    expect(mainSrc).toMatch(/catch \(e: any\) \{\s*\n\s*return \{ ok: false/);
  });

  it('the html payload is validated (type, non-empty, bounded)', () => {
    expect(mainSrc).toMatch(/typeof html !== 'string' \|\| html\.length === 0 \|\| html\.length > 500_000/);
  });

  it('the hidden print window is sandboxed and always destroyed', () => {
    expect(mainSrc).toMatch(/nodeIntegration: false, contextIsolation: true, sandbox: true/);
    expect(mainSrc).toMatch(/finally \{\s*\n\s*win\?\.destroy\(\)/);
  });

  it('IPC is registered at app start', () => {
    expect(indexSrc).toMatch(/registerPosPrintingIpc\(\)/);
  });
});

describe('preload — narrow electronAPI exposure', () => {
  it('exposes ONLY getPrinters + printTicketHtml (no fs/shell/raw ipc)', () => {
    const block = preloadSrc.slice(preloadSrc.indexOf("exposeInMainWorld('electronAPI'"));
    expect(block).toMatch(/getPrinters: \(\) => ipcRenderer\.invoke\('pos-print:getPrinters'\)/);
    expect(block).toMatch(/printTicketHtml: \(html: string, deviceName\?: string\)/);
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
