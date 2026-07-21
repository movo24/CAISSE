/**
 * Template du ticket papier The Wesley (buildReceiptDOM via buildReceiptHtml).
 *
 * Vérifie sur le HTML réellement envoyé à l'imprimante :
 *  - largeurs 58 et 80 mm (page + corps) ;
 *  - logo N&B centré (uniquement si configuré) ;
 *  - mentions légales dynamiques : champ vide = ligne absente ;
 *  - qté × PU, remises, sous-total, ventilation TVA, TOTAL TTC, reçu/rendu ;
 *  - phrase personnalisée, QR + texte, formule de fin ;
 *  - accents et noms longs intacts (chemin HTML) ;
 *  - AUCUN texte « TEST » sur un ticket de vente réel.
 *
 * Optionnel : TICKET_PROOF_DIR=<dir> fait écrire les artefacts HTML 58/80 mm
 * (preuves visuelles du chantier) — aucun effet sans la variable.
 */
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { peripheralBridge, type TicketData } from './peripheralBridge';
import { buildTicketData } from './salePeripherals';

const PROOF_DIR = process.env.TICKET_PROOF_DIR;

const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function fullTicket(paperWidthMm: 58 | 80, overrides: Partial<TicketData> = {}): TicketData {
  return {
    ...buildTicketData({
      storeName: 'The Wesley — Démo',
      operatingCompanyName: 'Société Exploitante Démo',
      storeAddress: '1 rue de la Démonstration',
      addressLine2: '94000 Créteil',
      siret: '00000000000000',
      tvaIntracom: 'FR00000000000',
      rcs: 'RCS Démo 000 000 000',
      capitalSocial: '1 000 EUR',
      phone: '01 00 00 00 00',
      website: 'thewesleys.fr',
      nifCaisse: 'NF-DEMO',
      softwareVersion: '1.1.0',
      logoDataUrl: PIXEL,
      ticketNumber: 'T-000123',
      date: new Date('2026-07-18T11:30:00'),
      cashierName: 'Awa',
      items: [
        { name: 'Guimauve artisanale à la fraise des bois — édition limitée été', quantity: 2, unitPriceMinorUnits: 350, taxRate: 5.5 },
        { name: 'Peluche Wesley « çàéùî »', quantity: 1, unitPriceMinorUnits: 1300, discountMinorUnits: 100, taxRate: 20 },
      ],
      subtotalMinorUnits: 2000,
      discountMinorUnits: 100,
      totalMinorUnits: 1900,
      payments: [{ method: 'cash', amountMinorUnits: 1900 }],
      changeMinorUnits: 100,
      footer: 'Échange possible sous 14 jours avec le ticket.',
      finalMessage: 'Merci et à bientôt chez The Wesley',
      qrDataUrl: PIXEL,
      qrContent: 'https://exemple.test/ticket/AbCdEf0123456789_-AbCdEf01234567',
      qrText: 'Scannez pour retrouver votre ticket et découvrir nos nouveautés',
    }),
    paperWidthMm,
    ...overrides,
  };
}

function render(data: TicketData): string {
  return (peripheralBridge as any).buildReceiptHtml(data) as string;
}

describe('Template ticket papier — refonte The Wesley', () => {
  it.each([58, 80] as const)('largeur %imm : @page et corps adaptés', (w) => {
    const html = render(fullTicket(w));
    expect(html).toContain(`size: ${w}mm auto`);
    expect(html).toContain(`width: ${w === 58 ? 48 : 72}mm`);
    if (PROOF_DIR) {
      fs.mkdirSync(PROOF_DIR, { recursive: true });
      fs.writeFileSync(path.join(PROOF_DIR, `ticket-${w}mm.html`), html);
    }
  });

  it('logo N&B centré présent quand configuré, absent sinon', () => {
    const withLogo = render(fullTicket(80));
    expect(withLogo).toContain('class="logo"');
    expect(withLogo).toContain('grayscale(100%)');
    const noLogo = render(fullTicket(80, { logoDataUrl: null }));
    expect(noLogo).not.toContain('class="logo"');
  });

  it('mentions légales dynamiques : champ vide = ligne absente (jamais « SIRET: »)', () => {
    const html = render(
      fullTicket(80, { siret: '', rcs: undefined, tvaIntracom: '', capitalSocial: undefined }),
    );
    expect(html).not.toContain('SIRET');
    expect(html).not.toContain('RCS');
    expect(html).not.toMatch(/TVA [A-Z]/); // pas de mention TVA intracom vide
  });

  it('contenu fiscal complet : qté × PU, remise, sous-total, ventilation TVA, TOTAL TTC', () => {
    const html = render(fullTicket(80));
    expect(html).toContain('2 x 3.50');
    expect(html).toContain('Remise: -1.00 EUR');
    expect(html).toContain('Sous-total');
    expect(html).toContain('TOTAL TTC');
    expect(html).toContain('5.5%');
    expect(html).toContain('20%');
  });

  it('espèces : lignes Reçu / Rendu', () => {
    const html = render(fullTicket(80));
    expect(html).toContain('Recu');
    expect(html).toContain('Rendu');
  });

  it('QR + texte + phrase + formule de fin, pilotés par la config', () => {
    const html = render(fullTicket(80));
    expect(html).toContain('class="qr"');
    expect(html).toContain('Scannez pour retrouver votre ticket');
    expect(html).toContain('Échange possible sous 14 jours');
    expect(html).toContain('Merci et à bientôt chez The Wesley');
  });

  it('hors ligne : note « après synchronisation » à la place du QR', () => {
    const html = render(
      fullTicket(80, {
        qrDataUrl: null,
        qrContent: null,
        offlineNote: 'Ticket numérique disponible après synchronisation',
      }),
    );
    expect(html).not.toContain('class="qr"');
    expect(html).toContain('après synchronisation');
  });

  it('accents et noms longs intacts sur le chemin HTML', () => {
    const html = render(fullTicket(58));
    expect(html).toContain('Guimauve artisanale à la fraise des bois');
    expect(html).toContain('çàéùî');
  });

  it('AUCUN texte de test sur un ticket de vente réel', () => {
    const html = render(fullTicket(80));
    expect(html).not.toMatch(/TEST/);
    const test = render(fullTicket(80, { testMarker: 'TEST — SANS VALEUR FISCALE' }));
    expect(test).toContain('TEST — SANS VALEUR FISCALE');
  });

  it("ESC/POS : QR natif présent quand qrContent est fourni, jamais sinon", () => {
    const cmds = (peripheralBridge as any).buildESCPOSCommands(fullTicket(80)) as string;
    expect(cmds).toContain('\x1D(k');
    expect(cmds).toContain('https://exemple.test/ticket/');
    const offline = (peripheralBridge as any).buildESCPOSCommands(
      fullTicket(80, { qrContent: null, qrDataUrl: null, offlineNote: 'Ticket numérique disponible après synchronisation' }),
    ) as string;
    expect(offline).not.toContain('\x1D(k');
    expect(offline).toContain('synchronisation'); // note présente
  });
});
