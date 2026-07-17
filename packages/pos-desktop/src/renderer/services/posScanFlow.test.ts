import { describe, it, expect, beforeEach } from 'vitest';
import { usePOSStore } from '../stores/posStore';
import { resolveLocalScan, type ScanProduct, type ScanOutcome } from './scanResolver';
import { buildSnapshot } from './customerDisplay/snapshot';

/**
 * Flux scan → panier → écran client, exercé sur le VRAI store POS et la VRAIE
 * projection écran client, avec le catalogue LOCAL (hors-ligne). Reproduit la
 * chaîne réelle : `resolveLocalScan` (offline) → `addToCart` (incrément intégré).
 * Couvre les scénarios 1, 2, 3, 4, 6, 7, 8 de la spec scanner.
 */

const CATALOGUE: ScanProduct[] = [
  { id: 'p1', ean: '3760012345678', name: 'Coca 33cl', priceMinorUnits: 150, isActive: true },
  { id: 'p2', ean: '3760099999999', name: 'Eau 50cl', priceMinorUnits: 100, isActive: true },
  { id: 'p3', ean: '20123452', name: 'Bonbon (désactivé)', priceMinorUnits: 90, isActive: false },
];

/** Applique un scan comme le fait la caisse (chemin local, hors-ligne). */
function applyScan(code: string): ScanOutcome {
  const outcome = resolveLocalScan(code, CATALOGUE);
  if (outcome.status === 'add') {
    const p = outcome.product;
    usePOSStore.getState().addToCart({
      productId: p.id,
      ean: p.ean,
      name: p.name,
      unitPriceMinorUnits: p.priceMinorUnits,
    });
  }
  return outcome;
}

const cart = () => usePOSStore.getState().cartItems;

beforeEach(() => {
  usePOSStore.getState().clearCart();
});

describe('Flux scanner → panier', () => {
  it('1. produit existant ajouté par scan', () => {
    const o = applyScan('3760012345678');
    expect(o.status).toBe('add');
    expect(cart()).toHaveLength(1);
    expect(cart()[0]).toMatchObject({ productId: 'p1', quantity: 1, unitPriceMinorUnits: 150 });
  });

  it('2. deuxième scan du même produit → quantité 2', () => {
    applyScan('3760012345678');
    applyScan('3760012345678');
    expect(cart()).toHaveLength(1);
    expect(cart()[0].quantity).toBe(2);
  });

  it('3. deux produits scannés rapidement → deux lignes', () => {
    applyScan('3760012345678');
    applyScan('3760099999999');
    expect(cart()).toHaveLength(2);
    expect(cart().map((i) => i.productId).sort()).toEqual(['p1', 'p2']);
  });

  it('4. code inconnu → aucune ligne ajoutée, aucun faux produit', () => {
    const o = applyScan('0000000000000');
    expect(o).toEqual({ status: 'unknown', code: '0000000000000' });
    expect(cart()).toHaveLength(0);
  });

  it('produit désactivé → refus, aucune ligne ajoutée', () => {
    const o = applyScan('20123452');
    expect(o.status).toBe('refused');
    expect(cart()).toHaveLength(0);
  });

  it('6. scanner toujours actif après paiement / réinitialisation du panier', () => {
    applyScan('3760012345678');
    expect(cart()).toHaveLength(1);
    usePOSStore.getState().clearCart(); // simulate paiement terminé → nouveau panier
    expect(cart()).toHaveLength(0);
    const o = applyScan('3760099999999'); // le scan fonctionne encore
    expect(o.status).toBe('add');
    expect(cart()).toHaveLength(1);
    expect(cart()[0].productId).toBe('p2');
  });

  it('8. hors-ligne : résolution sur le catalogue local, sans réseau', () => {
    // resolveLocalScan n'appelle aucun réseau : trouvé localement → add.
    const o = applyScan('3760099999999');
    expect(o.status).toBe('add');
    expect(cart()[0].productId).toBe('p2');
  });
});

describe('7. synchronisation avec l’écran client', () => {
  it('le produit scanné apparaît dans la projection écran client', () => {
    applyScan('3760012345678');
    applyScan('3760012345678'); // quantité 2
    const items = cart().map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unitPriceMinorUnits: i.unitPriceMinorUnits,
      discountMinorUnits: i.discountMinorUnits,
    }));
    const subtotal = items.reduce((s, i) => s + i.unitPriceMinorUnits * i.quantity, 0);
    const snap = buildSnapshot(
      { items, subtotalMinorUnits: subtotal, totalDiscountMinorUnits: 0, totalMinorUnits: subtotal, customer: null },
      { storeName: 'The Wesley', terminalLabel: 'Caisse 1' },
      '2026-07-17T00:00:00.000Z',
    );
    expect(snap.items).toHaveLength(1);
    expect(snap.items[0]).toMatchObject({ name: 'Coca 33cl', quantity: 2, lineTotalMinorUnits: 300 });
    expect(snap.itemCount).toBe(2);
    expect(snap.totalMinorUnits).toBe(300);
  });
});
