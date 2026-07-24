// @vitest-environment jsdom
/**
 * Contexte de session du Catalogue — règle UX 2026-07-24 : le retour d'une
 * fiche produit restaure exactement l'état quitté ; l'accès direct (aucun
 * contexte) retombe sur les défauts (Statut : Actif côté liste).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { saveCatalogContext, loadCatalogContext, clearCatalogContext, consumeCatalogContext } from './catalogContext';

const FULL = {
  search: 'coca', fStatus: 'inactive', fBrand: 'b1', fSupplier: 's1',
  fCategory: 'c1', fTax: '20', fOutOfStock: true, fBelowThreshold: false,
  fNoImage: false, fNoSupplier: false, fNoCategory: true,
  sortBy: 'price' as const, sortDir: 'DESC' as const, page: 3, scrollY: 420,
};

beforeEach(() => sessionStorage.clear());

describe('catalogContext', () => {
  it('sauvegarde puis recharge un contexte complet à l’identique', () => {
    saveCatalogContext(FULL);
    const ctx = loadCatalogContext();
    expect(ctx).toMatchObject(FULL);
    expect(ctx?.savedAt).toBeGreaterThan(0);
  });

  it('aucun contexte (ouverture directe / nouvelle session) → null', () => {
    expect(loadCatalogContext()).toBeNull();
  });

  it('données corrompues → null, jamais d’exception', () => {
    sessionStorage.setItem('catalog.context', '{pas du json');
    expect(loadCatalogContext()).toBeNull();
    sessionStorage.setItem('catalog.context', JSON.stringify({ nimporte: 'quoi' }));
    expect(loadCatalogContext()).toBeNull();
  });

  it('valeurs invalides assainies (page/scroll/tri)', () => {
    sessionStorage.setItem('catalog.context', JSON.stringify({
      ...FULL, page: -2, scrollY: Infinity, sortBy: 'hack', sortDir: 'zigzag',
    }));
    const ctx = loadCatalogContext();
    expect(ctx).toMatchObject({ page: 1, scrollY: 0, sortBy: 'name', sortDir: 'ASC' });
  });

  it('clearCatalogContext efface', () => {
    saveCatalogContext(FULL);
    clearCatalogContext();
    expect(loadCatalogContext()).toBeNull();
  });

  it('consumeCatalogContext : lit UNE fois puis supprime (2ᵉ lecture = null)', () => {
    saveCatalogContext(FULL);
    // 1ʳᵉ consommation : renvoie le contexte…
    expect(consumeCatalogContext()).toMatchObject(FULL);
    // …et l'a supprimé : un accès direct ultérieur ne retrouve rien.
    expect(consumeCatalogContext()).toBeNull();
    expect(loadCatalogContext()).toBeNull();
  });

  it('consumeCatalogContext : un contexte corrompu est aussi effacé (pas de résidu collant)', () => {
    sessionStorage.setItem('catalog.context', '{corrompu');
    expect(consumeCatalogContext()).toBeNull();
    expect(sessionStorage.getItem('catalog.context')).toBeNull();
  });
});
