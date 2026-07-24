/**
 * Chantier 4 — stock négatif autorisé, côté POS (cache stock local offline).
 *
 * RÈGLE MÉTIER : le stock informatique ne bloque JAMAIS une vente en caisse.
 * Hors ligne, la vente est mise en file et le cache local est décrémenté SANS
 * plancher : 0 → -1, -1 - 2 → -3. Le négatif est l'information qui alimente
 * l'avertissement non bloquant (« vente autorisée, anomalie transmise au
 * BackOffice à la synchronisation »).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useOfflineStore } from './offlineStore';

describe('offlineStore — cache stock local, négatif autorisé (chantier 4)', () => {
  beforeEach(() => {
    useOfflineStore.getState().setLocalStockCache({});
  });

  it('stock 0, vente 1 → -1 (jamais bloqué, jamais plafonné)', () => {
    useOfflineStore.getState().setLocalStockCache({ '111': 0 });
    useOfflineStore.getState().decrementLocalStock('111', 1);
    expect(useOfflineStore.getState().localStockCache['111']).toBe(-1);
  });

  it('stock 2, vente 5 → -3', () => {
    useOfflineStore.getState().setLocalStockCache({ '111': 2 });
    useOfflineStore.getState().decrementLocalStock('111', 5);
    expect(useOfflineStore.getState().localStockCache['111']).toBe(-3);
  });

  it('stock déjà -1, nouvelle vente de 2 → -3 (la dette se cumule)', () => {
    useOfflineStore.getState().setLocalStockCache({ '111': -1 });
    useOfflineStore.getState().decrementLocalStock('111', 2);
    expect(useOfflineStore.getState().localStockCache['111']).toBe(-3);
  });

  it('produit inconnu du cache : traité comme stock 0 → -qty', () => {
    useOfflineStore.getState().decrementLocalStock('999', 2);
    expect(useOfflineStore.getState().localStockCache['999']).toBe(-2);
  });
});
