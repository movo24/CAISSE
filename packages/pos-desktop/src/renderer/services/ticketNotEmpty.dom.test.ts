// @vitest-environment jsdom
/**
 * TEST D'INTÉGRATION — « le document envoyé à l'impression n'est JAMAIS vide ».
 *
 * Contexte (audit du 2026-08-06). Cinq jours de correctifs ont porté sur une
 * hypothèse fausse : « le HTML du ticket est vide ». La mesure sur la caisse a
 * montré l'inverse — le HTML est complet ; c'est `webContents.print()` qui ne
 * remettait AUCUNE opération de dessin au pilote Star (61 octets, 0 % d'encre).
 *
 * Ce test verrouille la moitié amont de la chaîne, celle qui est vérifiable en
 * CI : depuis un `TicketData` de vente, le HTML RÉELLEMENT transmis au canal
 * d'impression contient bien l'intégralité du ticket. Il aurait été VERT
 * pendant tout l'incident — c'est justement ce qui prouve que la panne était en
 * aval, et il empêche désormais toute régression silencieuse en amont.
 *
 * La moitié aval (le pilote reçoit-il de l'encre ?) n'est PAS simulable :
 * elle se mesure sur la caisse en capturant la sortie du pilote sur un port
 * fichier. Voir `posImagePrint.ts` pour les chiffres relevés.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { peripheralBridge, type TicketData } from './peripheralBridge';

/** Ticket de vente représentatif : articles, remise, TVA, paiements, rendu. */
function saleTicket(overrides: Partial<TicketData> = {}): TicketData {
  return {
    storeName: 'THE WESLEY’S',
    storeAddress: '12 rue de Test',
    addressLine2: '75000 PARIS',
    siret: '12345678900011',
    tvaIntracom: 'FR00123456789',
    ticketNumber: 'T-000042',
    date: '06/08/2026 10:30',
    cashierName: 'Alice',
    items: [
      { name: 'CHARBON BLACK COCO', quantity: 2, unitPrice: 6, total: 12, taxRate: 20 },
      { name: 'BOISSON MENTHE', quantity: 1, unitPrice: 3.5, total: 3, discount: 0.5, taxRate: 5.5 },
    ],
    subtotal: 15.5,
    discount: 0.5,
    total: 15,
    payments: [{ method: 'Especes', amount: 15 }],
    change: 5,
    cashReceived: 20,
    vat: [
      { rate: 5.5, ht: 2.84, tva: 0.16, ttc: 3 },
      { rate: 20, ht: 10, tva: 2, ttc: 12 },
    ],
    footer: 'Merci de votre visite !',
    nifCaisse: 'NIF-001',
    softwareVersion: '1.8.15',
    ...overrides,
  };
}

/** Capture le HTML réellement remis au canal d'impression du main. */
function installPrinterSpy(): { calls: Array<{ html: string; device?: string }> } {
  const calls: Array<{ html: string; device?: string }> = [];
  (window as any).electronAPI = {
    printTicketHtml: (html: string, device?: string) => {
      calls.push({ html, device });
      return Promise.resolve({ ok: true });
    },
    getPrinters: () => Promise.resolve(['Star TSP100 Cutter (TSP143)']),
    openCashDrawer: () => Promise.resolve({ ok: true }),
  };
  return { calls };
}

/** Force le bridge sur le chemin thermique USB (desktop Windows). */
function forceThermalUsb(): void {
  (peripheralBridge as any)._status.printer = {
    type: 'thermal_usb',
    connected: true,
    name: 'Star TSP100 Cutter (TSP143)',
  };
}

describe('ticket envoyé à l’impression — jamais vide, jamais amputé', () => {
  let spy: { calls: Array<{ html: string; device?: string }> };

  beforeEach(() => {
    localStorage.clear();
    spy = installPrinterSpy();
    forceThermalUsb();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as any).electronAPI;
  });

  it('un ticket de vente produit un document NON VIDE remis à l’impression', async () => {
    const ok = await peripheralBridge.printTicket(saleTicket(), { allowBrowserFallback: false });
    expect(ok).toBe(true);
    expect(spy.calls).toHaveLength(1);

    const html = spy.calls[0].html;
    // Un document « vide » (doctype + <html> nu) fait quelques centaines
    // d'octets : le seuil distingue un vrai ticket d'une coquille.
    expect(html.length).toBeGreaterThan(1500);
    expect(html).toMatch(/^<!doctype html>/i);
    // Le <body> contient du texte réel, pas seulement du balisage.
    const bodyText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    expect(bodyText.length).toBeGreaterThan(200);
  });

  it('le document contient TOUTES les données fiscales et commerciales de la vente', async () => {
    await peripheralBridge.printTicket(saleTicket(), { allowBrowserFallback: false });
    const html = spy.calls[0].html;

    for (const attendu of [
      'THE WESLEY', // enseigne
      '12 rue de Test', // adresse
      '12345678900011', // SIRET
      'FR00123456789', // TVA intracom
      'T-000042', // numéro de ticket
      'Alice', // vendeur
      'CHARBON BLACK COCO', // article 1
      'BOISSON MENTHE', // article 2
      'TOTAL TTC', // total
      '15.00', // montant total
      'Especes', // paiement
      'NIF-001', // mention NF525
    ]) {
      expect(html).toContain(attendu);
    }
    // Ventilation TVA : les deux taux présents.
    expect(html).toMatch(/5\.5\s*%|5,5\s*%|5\.5%/);
    expect(html).toContain('20%');
  });

  it('remise, reçu et rendu monnaie apparaissent sur le document', async () => {
    await peripheralBridge.printTicket(saleTicket(), { allowBrowserFallback: false });
    const html = spy.calls[0].html;
    expect(html).toMatch(/Remise/i);
    expect(html).toContain('Recu');
    expect(html).toContain('Rendu');
    expect(html).toContain('20.00'); // espèces reçues
    expect(html).toContain('5.00'); // monnaie rendue
  });

  it('un ticket minimal (1 article, sans option) reste non vide et complet', async () => {
    const minimal: TicketData = {
      storeName: 'CAISSE',
      storeAddress: '',
      siret: '',
      tvaIntracom: '',
      ticketNumber: 'T-1',
      date: '06/08/2026',
      cashierName: 'Bob',
      items: [{ name: 'ARTICLE', quantity: 1, unitPrice: 1, total: 1 }],
      subtotal: 1,
      discount: 0,
      total: 1,
      payments: [{ method: 'CB', amount: 1 }],
      change: 0,
      footer: '',
      nifCaisse: '',
      softwareVersion: '1.8.15',
    };
    await peripheralBridge.printTicket(minimal, { allowBrowserFallback: false });
    const html = spy.calls[0].html;
    expect(html).toContain('ARTICLE');
    expect(html).toContain('TOTAL TTC');
    expect(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length).toBeGreaterThan(60);
  });

  it('le document part sur la file EXACTE sélectionnée (jamais l’imprimante par défaut)', async () => {
    // Régression réelle : l'imprimante par défaut de Windows avait été promue
    // sur la file TIROIR (document quasi vide + coupe) → « petit bout de papier ».
    await peripheralBridge.printTicket(saleTicket(), { allowBrowserFallback: false });
    expect(spy.calls[0].device).toBe('Star TSP100 Cutter (TSP143)');
  });

  it('échec du canal d’impression → false honnête, jamais un faux « imprimé »', async () => {
    (window as any).electronAPI.printTicketHtml = () =>
      Promise.resolve({ ok: false, error: 'file hors connexion' });
    const ok = await peripheralBridge.printTicket(saleTicket(), { allowBrowserFallback: false });
    expect(ok).toBe(false);
  });
});
