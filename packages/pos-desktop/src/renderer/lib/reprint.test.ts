/** P361 — POS-036 : réimpression (mapper duplicata + journal immuable). */
import { describe, it, expect } from 'vitest';
import { buildDuplicateTicketData, recordReprint, StoreMeta } from './reprint';
import { buildESCPOSBytes } from '../hooks/useBluetoothPrinter';
import type { TicketHistoryEntry } from '../stores/posStore';

const META: StoreMeta = {
  storeName: 'Wesley Candy Shop',
  storeAddress: '1 rue du Sucre',
  siret: '12345678900011',
  tvaIntracom: 'FR001234567',
  nifCaisse: 'NF-01',
  softwareVersion: '1.0.0',
};

const ENTRY: TicketHistoryEntry = {
  ticketNumber: 'T-000042',
  timestamp: new Date('2026-07-02T12:00:00'),
  items: [
    { name: 'Fraise Tagada', ean: '3017620422003', quantity: 2, unitPriceMinorUnits: 250, discountMinorUnits: 0 },
    { name: 'Réglisse', ean: '3017620422010', quantity: 1, unitPriceMinorUnits: 120, discountMinorUnits: 20 },
  ],
  payments: [{ method: 'cash' as any, amountMinorUnits: 1000 }],
  totalMinorUnits: 600,
  subtotalMinorUnits: 620,
  discountMinorUnits: 20,
  changeMinorUnits: 400,
  cashierName: 'Alice',
  reprintCount: 0,
  reprintLog: [],
};

describe('buildDuplicateTicketData', () => {
  const dup = buildDuplicateTicketData(ENTRY, META);

  it('marque DUPLICATA en tête (numéro de ticket) ET en pied — jamais confondable avec l’original', () => {
    expect(dup.ticketNumber).toBe('T-000042 — DUPLICATA n°1');
    expect(dup.footer).toContain('DUPLICATA n°1');
    expect(dup.footer).toContain('NE VAUT PAS ORIGINAL');
  });

  it('convertit les centimes en euros SANS recalcul métier (montants copiés)', () => {
    expect(dup.total).toBe(6.0);
    expect(dup.subtotal).toBe(6.2);
    expect(dup.discount).toBe(0.2);
    expect(dup.change).toBe(4.0);
    expect(dup.items[0]).toEqual(
      expect.objectContaining({ quantity: 2, unitPrice: 2.5, total: 5.0, discount: undefined }),
    );
    expect(dup.items[1].total).toBe(1.0); // 120 − 20 de remise ligne
    expect(dup.items[1].discount).toBe(0.2);
    expect(dup.payments).toEqual([{ method: 'cash', amount: 10.0 }]);
  });

  it('affiche la date de la VENTE originale (pas celle de la réimpression)', () => {
    expect(dup.date).toContain('02/07/2026');
  });

  it('le numéro de duplicata suit le compteur (2e réimpression → n°2)', () => {
    const second = buildDuplicateTicketData({ ...ENTRY, reprintCount: 1 }, META);
    expect(second.ticketNumber).toContain('DUPLICATA n°2');
  });

  it('bout-en-bout : la trame ESC/POS du duplicata est valide et porte le marquage', () => {
    const bytes = buildESCPOSBytes(dup);
    const s = new TextDecoder().decode(bytes);
    expect(bytes[0]).toBe(0x1b); // reset en tête
    expect(s).toContain('DUPLICATA');
    expect(s).toContain('6.00 EUR');
  });
});

describe('recordReprint — journal immuable', () => {
  it('incrémente le compteur et appende {at, by} sans muter l’original', () => {
    const at = new Date('2026-07-03T09:00:00Z');
    const next = recordReprint(ENTRY, 'Bob', at);
    expect(next.reprintCount).toBe(1);
    expect(next.reprintLog).toEqual([{ at, by: 'Bob' }]);
    // l'original est INTACT
    expect(ENTRY.reprintCount).toBe(0);
    expect(ENTRY.reprintLog).toEqual([]);
    // une 2e réimpression s'empile
    const third = recordReprint(next, 'Alice');
    expect(third.reprintCount).toBe(2);
    expect(third.reprintLog).toHaveLength(2);
  });
});
