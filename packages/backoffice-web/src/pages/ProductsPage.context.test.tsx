// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { loadCatalogContext } from '../utils/catalogContext';
import { MemoryRouter } from 'react-router-dom';

/**
 * Règle UX 2026-07-24 — Catalogue → Produits au retour d'une fiche :
 *  - le contexte de session (recherche, filtres, statut, tri, pagination) est
 *    restauré EXACTEMENT, et la requête serveur part avec ces valeurs ;
 *  - ouverture directe (aucun contexte) → défauts, dont Statut : Actif.
 */

const listMock = vi.fn();

vi.mock('../services/api', () => {
  const empty = () => Promise.resolve({ data: [] });
  return {
    productsApi: new Proxy(
      {},
      {
        get: (_t, prop: string) => {
          if (prop === 'list') return (...a: unknown[]) => listMock(...a);
          if (prop === 'catalogStats') return () => Promise.resolve({ data: null });
          return empty;
        },
      },
    ),
    storesApi: { list: () => Promise.resolve({ data: [] }) },
  };
});
vi.mock('../stores/authStore', () => ({
  useAuthStore: (sel?: any) => {
    const state = { employee: { id: 'e1', role: 'admin', storeId: 'store-1' }, stores: [], currentStoreId: 'store-1' };
    return sel ? sel(state) : state;
  },
}));
vi.mock('../hooks/useCurrentStoreId', () => ({ useCurrentStoreId: () => 'store-1' }));

import { ProductsPage } from './ProductsPage';
import { saveCatalogContext } from '../utils/catalogContext';

function renderList() {
  return render(
    <MemoryRouter initialEntries={['/products']}>
      <ProductsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  listMock.mockReset();
  listMock.mockResolvedValue({ data: { items: [], total: 0 } });
});

describe('Catalogue — restauration du contexte de session', () => {
  it('retour de fiche : recherche, statut, catégorie, tri et PAGE restaurés dans la requête', async () => {
    saveCatalogContext({
      search: 'coca', fStatus: 'inactive', fBrand: 'b1', fSupplier: '',
      fCategory: 'c9', fTax: '', fOutOfStock: false, fBelowThreshold: false,
      fNoImage: false, fNoSupplier: false, fNoCategory: false,
      sortBy: 'price', sortDir: 'DESC', page: 3, scrollY: 0,
    });
    renderList();
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    // Laisse passer la fenêtre de débounce (300 ms) : la page restaurée ne doit
    // PAS être écrasée par les effets « retour page 1 » au montage.
    await new Promise((r) => setTimeout(r, 400));
    const lastCall = listMock.mock.calls[listMock.mock.calls.length - 1][0] as Record<string, unknown>;
    expect(lastCall).toMatchObject({
      search: 'coca',
      status: 'inactive',
      categoryId: 'c9',
      brandId: 'b1',
      sortBy: 'price',
      sortDir: 'DESC',
      page: 3,
    });
  });

  it('ouverture directe (aucun contexte) : défaut Statut : Actif, page 1', async () => {
    renderList();
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    const lastCall = listMock.mock.calls[listMock.mock.calls.length - 1][0] as Record<string, unknown>;
    expect(lastCall).toMatchObject({ status: 'active', page: 1 });
    // Le sélecteur Statut affiche bien « Actif » par défaut.
    const statusSelect = screen.getAllByRole('combobox').find(
      (el) => (el as HTMLSelectElement).value === 'active',
    );
    expect(statusSelect).toBeTruthy();
  });

  it('CONSOMMATION UNIQUE : le contexte est effacé dès le montage (sessionStorage vidé)', async () => {
    saveCatalogContext({
      search: 'coca', fStatus: 'inactive', fBrand: '', fSupplier: '',
      fCategory: '', fTax: '', fOutOfStock: false, fBelowThreshold: false,
      fNoImage: false, fNoSupplier: false, fNoCategory: false,
      sortBy: 'name', sortDir: 'ASC', page: 2, scrollY: 0,
    });
    renderList();
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    // Dès le montage, le contexte a été CONSOMMÉ → plus rien en session.
    await waitFor(() => expect(loadCatalogContext()).toBeNull());
  });

  it('RÉGRESSION owner : accès direct APRÈS un retour de fiche ne réapplique PAS l’ancien contexte', async () => {
    // 1) Retour de fiche : contexte présent → restauré (page 3, statut inactive).
    saveCatalogContext({
      search: 'zzz', fStatus: 'inactive', fBrand: '', fSupplier: '',
      fCategory: '', fTax: '', fOutOfStock: false, fBelowThreshold: false,
      fNoImage: false, fNoSupplier: false, fNoCategory: false,
      sortBy: 'name', sortDir: 'ASC', page: 3, scrollY: 0,
    });
    const first = renderList();
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 400));
    expect(listMock.mock.calls.at(-1)![0]).toMatchObject({ status: 'inactive', page: 3 });

    // 2) L'utilisateur quitte le catalogue puis y revient EN ACCÈS DIRECT
    //    (démontage + remontage, même onglet, SANS repasser par une fiche).
    first.unmount();
    listMock.mockClear();
    const second = render(
      <MemoryRouter initialEntries={['/products']}>
        <ProductsPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    // Aucun ancien contexte : retour aux défauts (Statut : Actif, page 1).
    expect(listMock.mock.calls.at(-1)![0]).toMatchObject({ status: 'active', page: 1 });
    second.unmount();
  });
});
