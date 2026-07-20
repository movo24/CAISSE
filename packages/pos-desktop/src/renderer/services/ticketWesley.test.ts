/**
 * Refonte ticket The Wesley — côté caisse.
 *  - computeTicketVat : ventilation TVA identique à la formule backend ;
 *  - buildTicketData : QR/logo/mentions optionnels, reçu/rendu espèces ;
 *  - encodeEscpos : accents CP1252 corrects (jamais d'UTF-8 multi-octets) ;
 *  - buildEscposQr : trame GS ( k valide portant l'URL publique ;
 *  - buildTicketUrl : jamais d'URL sans base configurée ou jeton invalide.
 */
import { describe, it, expect } from 'vitest';
import { computeTicketVat, buildTicketData } from './salePeripherals';
import { encodeEscpos, buildEscposQr } from './peripheralBridge';
import { buildTicketUrl } from './ticketQr';

describe('computeTicketVat', () => {
  it('ventile par taux avec la formule backend round(ttc×t/(100+t))', () => {
    const rows = computeTicketVat([
      { quantity: 2, unitPriceMinorUnits: 350, taxRate: 5.5 },
      { quantity: 1, unitPriceMinorUnits: 1300, taxRate: 20 },
    ]);
    expect(rows).toEqual([
      { rate: 5.5, ttc: 7, tva: 0.36, ht: 6.64 },
      { rate: 20, ttc: 13, tva: 2.17, ht: 10.83 },
    ]);
  });

  it('déduit la remise ligne du TTC ventilé', () => {
    const rows = computeTicketVat([
      { quantity: 1, unitPriceMinorUnits: 1000, discountMinorUnits: 200, taxRate: 20 },
    ]);
    expect(rows[0].ttc).toBe(8);
    expect(rows[0].tva).toBe(Math.round(800 * (20 / 120)) / 100);
  });

  it('ignore les lignes sans taux connu (catalogue hors ligne ancien)', () => {
    expect(computeTicketVat([{ quantity: 1, unitPriceMinorUnits: 500 }])).toEqual([]);
  });
});

describe('buildTicketData — refonte', () => {
  const base = {
    ticketNumber: 'T-000001',
    date: new Date('2026-07-18T10:00:00'),
    cashierName: 'Awa',
    items: [{ name: 'Bonbon', quantity: 2, unitPriceMinorUnits: 350, taxRate: 5.5 }],
    subtotalMinorUnits: 700,
    discountMinorUnits: 0,
    totalMinorUnits: 700,
    payments: [{ method: 'cash', amountMinorUnits: 700 }],
    changeMinorUnits: 300,
  };

  it('calcule la ventilation TVA et le reçu espèces (encaissé + rendu)', () => {
    const td = buildTicketData(base);
    expect(td.vat).toHaveLength(1);
    expect(td.vat![0].rate).toBe(5.5);
    // Espèces : « Reçu » = montant encaissé (700) + monnaie rendue (300).
    expect(td.cashReceived).toBe(10);
    expect(td.change).toBe(3);
  });

  it('sans config : pas de QR, pas de logo, pas de mention vide', () => {
    const td = buildTicketData(base);
    expect(td.qrDataUrl).toBeNull();
    expect(td.qrContent).toBeNull();
    expect(td.logoDataUrl).toBeNull();
    expect(td.rcs).toBeUndefined();
  });

  it('transporte QR/logo/mentions quand configurés (Dashboard)', () => {
    const td = buildTicketData({
      ...base,
      logoDataUrl: 'data:image/png;base64,AAA',
      rcs: 'RCS Créteil 000 000 000',
      website: 'https://thewesleys.fr',
      qrDataUrl: 'data:image/png;base64,QQQ',
      qrContent: 'https://x/ticket/tok',
      qrText: 'Scannez',
      finalMessage: 'Merci et à bientôt chez The Wesley',
    });
    expect(td.logoDataUrl).toContain('data:image/png');
    expect(td.qrContent).toBe('https://x/ticket/tok');
    expect(td.finalMessage).toContain('The Wesley');
  });
});

describe('encodeEscpos — accents CP1252', () => {
  it('é è à ç € encodés sur UN octet (jamais UTF-8 multi-octets)', () => {
    const bytes = encodeEscpos('éèàç€');
    expect(Array.from(bytes)).toEqual([0xe9, 0xe8, 0xe0, 0xe7, 0x80]);
  });

  it('caractère hors CP1252 → translittéré ou « ? », jamais mojibake', () => {
    const bytes = encodeEscpos('日');
    expect(bytes.length).toBe(1);
    expect(bytes[0]).toBe(0x3f);
  });

  it('les octets de commande ESC/POS passent tels quels', () => {
    const bytes = encodeEscpos('\x1B@\x1Dt');
    expect(Array.from(bytes)).toEqual([0x1b, 0x40, 0x1d, 0x74]);
  });
});

describe('buildEscposQr', () => {
  it('émet la séquence GS ( k complète avec la charge utile', () => {
    const url = 'https://example.test/ticket/abcdef1234567890';
    const seq = buildEscposQr(url);
    expect(seq).toContain(url); // stockage des données
    expect(seq).toContain('\x1D(k'); // fonctions QR
    // Longueur annoncée = données + 3 (pL/pH little-endian)
    const storeLen = url.length + 3;
    expect(seq).toContain(String.fromCharCode(storeLen & 0xff));
  });
});

describe('buildTicketUrl — jamais de domaine codé en dur', () => {
  const tok = 'AbCdEf0123456789_-AbCdEf01234567';

  it('null sans base configurée (le moteur n’imprime pas de QR)', () => {
    expect(buildTicketUrl(null, tok)).toBeNull();
    expect(buildTicketUrl('', tok)).toBeNull();
  });

  it('null sans jeton (vente hors ligne pas encore synchronisée)', () => {
    expect(buildTicketUrl('https://api.example.test', null)).toBeNull();
  });

  it('refuse un jeton hors format (anti-injection d’URL)', () => {
    expect(buildTicketUrl('https://api.example.test', 'tok invalide!')).toBeNull();
  });

  it('assemble base + /ticket/ + jeton (slash final toléré)', () => {
    expect(buildTicketUrl('https://api.example.test/', tok)).toBe(
      `https://api.example.test/ticket/${tok}`,
    );
  });
});
