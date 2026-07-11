import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * PR #27 — impression ticket terrain, honnête (décision produit ratifiée) :
 * priorité au chemin iPad + Bluetooth existant ; JAMAIS de faux ticket / fausse
 * impression ; une plateforme qui ne peut pas imprimer doit LE DIRE clairement.
 */
const bridge = readFileSync(join(__dirname, 'peripheralBridge.ts'), 'utf8');
const payment = readFileSync(join(__dirname, '..', 'hooks', 'usePayment.ts'), 'utf8');
const ipad = readFileSync(join(__dirname, '..', 'components', 'ipad', 'IPadPOSLayout.tsx'), 'utf8');
const posPage = readFileSync(join(__dirname, '..', 'pages', 'POSPage.tsx'), 'utf8');

describe('peripheralBridge — no silent browser-dialog fallback on auto-print', () => {
  it('printTicket accepts allowBrowserFallback and every thermal failure honours it', () => {
    expect(bridge).toMatch(/printTicket\(data: TicketData, opts\?: \{ allowBrowserFallback\?: boolean \}\)/);
    // every fallback site is gated: no unconditional `return this.printBrowserFallback(` left
    // outside the browser_print/default switch arm
    const unguarded = bridge.match(/return this\.printBrowserFallback\(data\);/g) || [];
    expect(unguarded.length).toBe(0);
  });

  it('BT-hook print failure without fallback returns an honest false', () => {
    expect(bridge).toMatch(/if \(!allowBrowserFallback\) return false; \/\/ honest failure, no dialog/);
  });
});

describe('usePayment — the print outcome is tracked and truthful', () => {
  it('auto-print runs with allowBrowserFallback:false and records printed/print_failed', () => {
    expect(payment).toMatch(/printTicket\(ticketData, \{ allowBrowserFallback: false \}\)/);
    expect(payment).toMatch(/setLastPrintStatus\(ok \? 'printed' : 'print_failed'\)/);
  });

  it('no real printer → status no_printer (say it, never pretend)', () => {
    expect(payment).toMatch(/if \(!hasRealPrinter\) \{[\s\S]{0,200}setLastPrintStatus\('no_printer'\)/);
  });

  it('the status is per-sale (reset at finalize start) and exposed to the UI', () => {
    expect(payment).toMatch(/setLastPrintStatus\(null\); \/\/ per-sale outcome/);
    expect(payment).toMatch(/lastPrintStatus,/);
  });
});

describe('cash drawer — honest kick (PR #34 + kick spooler desktop)', () => {
  it('no invented drawer: le tiroir n’est « printer_kick » que si une imprimante thermique OS + le canal RAW existent', () => {
    // Pas de « printer_kick » posé par simple optimisme (isElectron seul).
    expect(bridge).not.toMatch(/type: this\.isElectron\(\) \? 'printer_kick' : 'none'/);
    // Le desktop pose printer_kick UNIQUEMENT sous garde (imprimante thermique + API RAW).
    expect(bridge).toMatch(/this\._status\.printer\.type === 'thermal_usb' && this\.isElectron\(\) && \(window as any\)\.electronAPI\?\.openCashDrawer/);
    // Repli honnête « none » conservé.
    expect(bridge).toMatch(/this\._status\.cashDrawer = \{ type: 'none', connected: false \};\s*\n\s*\}/);
  });

  it('la fausse « kick pulse sent » n’existe pas — seul un VRAI kick (BT ou spooler RAW) renvoie true', () => {
    expect(bridge).not.toMatch(/kick pulse sent/);
    expect(bridge).toMatch(/kick refused \(honest\)/);
    expect(bridge).toMatch(/return false; \/\/ real kick attempted and failed — say so/);
    // Kick desktop réel via spooler RAW, honnête : true seulement si res.ok.
    expect(bridge).toMatch(/electronAPI\?\.openCashDrawer/);
    expect(bridge).toMatch(/if \(res\?\.ok\)/);
    expect(bridge).toMatch(/vrai kick tenté et échoué/);
  });
});

describe('confirmation overlays — the cashier is TOLD when no ticket printed', () => {
  it('iPad overlay renders all three outcomes', () => {
    expect(ipad).toMatch(/lastPrintStatus === 'printed'/);
    expect(ipad).toMatch(/lastPrintStatus === 'print_failed'/);
    expect(ipad).toMatch(/lastPrintStatus === 'no_printer'/);
    expect(ipad).toMatch(/Aucune imprimante connectée — ticket NON imprimé/);
  });

  it('desktop overlay states clearly that no printer is wired', () => {
    expect(posPage).toMatch(/Aucune imprimante connectée — ticket NON imprimé/);
  });
});
