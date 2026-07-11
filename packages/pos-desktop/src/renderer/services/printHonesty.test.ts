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

/**
 * PR #57 — câblage impression + tiroir dans le flux de vente DESKTOP, durci
 * contre les 4 règles owner (ordre caisse strict, impression jamais bloquante,
 * pas de double exécution, statuts distincts).
 */
const history = readFileSync(join(__dirname, '..', 'components', 'pos', 'TicketHistoryModal.tsx'), 'utf8');

describe('desktop sale flow — hardening PR #57 (source guards)', () => {
  it('règle 3 : garde SYNCHRONE de ré-entrée sur finalizePayment (avant tout effet)', () => {
    expect(posPage).toMatch(/if \(finalizingRef\.current\) return;/);
    expect(posPage).toMatch(/finalizingRef\.current = true;/);
  });

  it('règle 3 : la garde d’idempotence est le SINGLETON de module persisté (survit remontage/redémarrage)', () => {
    expect(posPage).toMatch(/salePeripheralGuard,/);
    expect(posPage).toMatch(/guard: salePeripheralGuard,/);
    expect(posPage).not.toMatch(/new SalePeripheralGuard\(\)/);
  });

  it('clé d’idempotence = saleId (idempotency key UUID), JAMAIS ticketNumber', () => {
    // La vente est identifiée par la clé d'idempotence stable, pas par le numéro
    // fiscal séquentiel par magasin.
    expect(posPage).toMatch(/saleId: idempotencyKey/);
  });

  it('règle 1 : le tiroir ne s’ouvre qu’APRÈS la vente validée (saleValidated: true), jamais avant', () => {
    expect(posPage).toMatch(/finalizeSalePeripherals\(\{[\s\S]{0,400}saleValidated: true/);
  });

  it('règle : le panier est vidé APRÈS la capture du ticketData (buildTicketData avant clearCart)', () => {
    const buildIdx = posPage.indexOf('const ticketData = buildTicketData(');
    expect(buildIdx).toBeGreaterThan(-1);
    // Le clearCart du flux de vente est celui qui SUIT la construction du ticket.
    const clearIdx = posPage.indexOf('store.clearCart();', buildIdx);
    expect(clearIdx).toBeGreaterThan(buildIdx); // ticket construit avant que le panier disparaisse
  });

  it('règle 2 : trois statuts DISTINCTS affichés (vente / impression / tiroir), jamais fusionnés', () => {
    expect(posPage).toMatch(/lastDrawerStatus === 'opened'/);
    expect(posPage).toMatch(/lastDrawerStatus === 'open_failed'/);
    expect(posPage).toMatch(/setLastPrintStatus\(r\.printStatus\)/);
    expect(posPage).toMatch(/setLastDrawerStatus\(r\.drawerStatus\)/);
  });

  it('règle 2 : le message d’échec impression affirme que la vente reste validée', () => {
    expect(posPage).toMatch(/Vente validée|Vente validee/);
    expect(posPage).toMatch(/Réimpression possible depuis l'historique|Réimpression possible/);
  });

  it('règle 3 : la RÉIMPRESSION (duplicata) imprime mais N’OUVRE JAMAIS le tiroir', () => {
    // Le duplicata passe par printTicket direct, jamais par openCashDrawer,
    // finalizeSalePeripherals, ni la clé AUTO_DRAWER_OPEN, et ne recrée aucune vente.
    expect(history).toMatch(/peripheralBridge\.printTicket\(/);
    expect(history).not.toMatch(/openCashDrawer/);
    expect(history).not.toMatch(/finalizeSalePeripherals/);
    expect(history).not.toMatch(/AUTO_DRAWER_OPEN/);
    expect(history).not.toMatch(/salesApi\.create/);
  });
});
