/**
 * POS-037 — matériel simulé : preuve des trames ESC/POS de l'imprimante
 * SANS matériel (les builders sont purs). On vérifie les invariants du
 * protocole, pas le rendu visuel : reset en tête, coupe papier en fin,
 * impulsion tiroir-caisse exacte, contenu fiscal présent dans la trame.
 */
import { describe, it, expect } from 'vitest';
import {
  buildESCPOSBytes,
  buildTestTicketBytes,
  buildCashDrawerKickBytes,
} from './useBluetoothPrinter';
import type { TicketData } from '../services/peripheralBridge';

const ESC = 0x1b;
const GS = 0x1d;

const asString = (b: Uint8Array) => new TextDecoder().decode(b);
const startsWith = (b: Uint8Array, seq: number[]) => seq.every((v, i) => b[i] === v);
const endsWith = (b: Uint8Array, seq: number[]) =>
  seq.every((v, i) => b[b.length - seq.length + i] === v);

const ticket: TicketData = {
  storeName: 'Wesley Candy Shop',
  storeAddress: '1 rue du Sucre, Paris',
  siret: '12345678900011',
  tvaIntracom: 'FR001234567',
  ticketNumber: 'T-000042',
  date: '2026-07-02 12:00',
  cashierName: 'Alice',
  items: [
    { name: 'Fraise Tagada', quantity: 2, unitPrice: 2.5, total: 5.0 },
    { name: 'Réglisse', quantity: 1, unitPrice: 1.2, total: 1.2, discount: 0.2 },
  ],
  subtotal: 6.2,
  discount: 0.2,
  total: 6.0,
  payments: [
    { method: 'cash', amount: 10.0 },
    { method: 'card', amount: 0 },
  ],
  change: 4.0,
  footer: 'Merci de votre visite',
  nifCaisse: 'NF-CAISSE-01',
  softwareVersion: '1.0.0',
};

describe('POS-037 — trame ticket ESC/POS (imprimante simulée)', () => {
  const bytes = buildESCPOSBytes(ticket);
  const s = asString(bytes);

  it('commence par le reset imprimante ESC @ et finit par la coupe papier GS V 0', () => {
    expect(startsWith(bytes, [ESC, 0x40])).toBe(true);
    expect(endsWith(bytes, [GS, 0x56, 0x00])).toBe(true);
  });

  it('embarque les mentions fiscales et le contenu du ticket', () => {
    for (const needle of [
      'Wesley Candy Shop',
      'SIRET: 12345678900011',
      'TVA: FR001234567',
      'Ticket: T-000042',
      'Caissier: Alice',
      'Fraise Tagada',
      'TOTAL',
      '6.00 EUR',
      'NIF: NF-CAISSE-01',
    ]) {
      expect(s).toContain(needle);
    }
  });

  it('rend les paiements avec libellés caisse et le rendu monnaie quand > 0', () => {
    expect(s).toContain('Especes');
    expect(s).toContain('CB');
    expect(s).toContain('Rendu: 4.00 EUR');
    expect(s).toContain('Remise:           -0.20 EUR');
  });

  it('sans rendu ni remise, les lignes correspondantes sont absentes', () => {
    const s2 = asString(buildESCPOSBytes({ ...ticket, change: 0, discount: 0 }));
    expect(s2).not.toContain('Rendu:');
    expect(s2).not.toContain('Remise:           -');
  });
});

describe('POS-037 — ticket de test et tiroir-caisse', () => {
  it('le ticket de test est une trame ESC/POS valide (reset → contenu → coupe)', () => {
    const b = buildTestTicketBytes();
    expect(startsWith(b, [ESC, 0x40])).toBe(true);
    expect(endsWith(b, [GS, 0x56, 0x00])).toBe(true);
    expect(asString(b)).toContain('TEST IMPRIMANTE');
  });

  it('l’impulsion tiroir-caisse est EXACTEMENT ESC p 0 25 250 (pin 2, 50ms/500ms)', () => {
    expect(Array.from(buildCashDrawerKickBytes())).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa]);
  });
});
