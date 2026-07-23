// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Régression bug 2026-07-23 — recherche du Catalogue Produits :
 * chaque frappe démontait la page entière (spinner plein-page dès que
 * `loading && products.length === 0`), le champ perdait le focus et la saisie
 * était interrompue. Ces tests tapent VITE plusieurs lettres dans le vrai
 * composant et vérifient : focus conservé, valeur complète conservée, même
 * nœud DOM (aucun remount), résultats corrects, et réponses obsolètes ignorées.
 */

// ── Mock API : list() pilotable par test (délais / réponses par recherche) ──
type Deferred = { resolve: (v: any) => void; promise: Promise<any> };
const listCalls: Array<{ search: string | undefined; deferred: Deferred }> = [];
let autoResolve: ((search: string | undefined) => any[] | null) | null = null;

function makeApiProduct(name: string, extra: Partial<Record<string, unknown>> = {}) {
  return {
    id: `id-${name}`, ean: '4006381333931', name, priceMinorUnits: 100,
    stockQuantity: 0, status: 'active', ...extra,
  };
}

vi.mock('../services/api', () => ({
  productsApi: {
    list: (params: any) => {
      let resolve!: (v: any) => void;
      const promise = new Promise((r) => { resolve = r; });
      const deferred = { resolve, promise };
      listCalls.push({ search: params?.search, deferred });
      const auto = autoResolve?.(params?.search);
      // Réponse APRÈS un vrai délai (tâche séparée) : l'état `loading` est
      // réellement committé au DOM entre l'envoi et la réponse — comme en
      // production. (Une résolution synchrone serait batchée par React et
      // masquerait le bug de démontage.)
      if (auto) setTimeout(() => resolve({ data: { data: auto, meta: { total: auto.length } } }), 60);
      return promise;
    },
    catalogStats: () => Promise.resolve({ data: { total: 1, active: 1, outOfStock: 0, belowThreshold: 0 } }),
    listBrands: () => Promise.resolve({ data: [] }),
    listSuppliers: () => Promise.resolve({ data: [] }),
    listCategories: () => Promise.resolve({ data: [] }),
  },
}));
vi.mock('../hooks/useCurrentStoreId', () => ({ useCurrentStoreId: () => 'store-test' }));
vi.mock('../stores/authStore', () => ({
  useAuthStore: (sel?: any) => {
    const state = { employee: { role: 'admin' }, stores: [], currentStoreId: 'store-test' };
    return sel ? sel(state) : state;
  },
}));
vi.mock('../components/PriceAnalyticsPanel', () => ({ PriceAnalyticsPanel: () => null }));

import { ProductsPage } from './ProductsPage';

const SEARCH_PLACEHOLDER = /Rechercher par nom/;

async function renderLoaded() {
  render(<MemoryRouter><ProductsPage /></MemoryRouter>, );
  // Premier chargement : 1 produit (« Alpha »)
  await waitFor(() => expect(listCalls.length).toBeGreaterThan(0));
  listCalls[0].deferred.resolve({ data: { data: [makeApiProduct('Alpha')], meta: { total: 1 } } });
  const input = (await screen.findByPlaceholderText(SEARCH_PLACEHOLDER)) as HTMLInputElement;
  return input;
}

beforeEach(() => {
  cleanup();
  listCalls.length = 0;
  autoResolve = null;
});

describe('Catalogue — recherche fluide (focus, pas de remount, debounce)', () => {
  it('frappe rapide : focus conservé, valeur complète, AUCUN démontage, résultats de la dernière saisie', async () => {
    autoResolve = (search) => {
      if (!search) return [makeApiProduct('Alpha')];
      if (search === 'test') return [makeApiProduct('Produit test')];
      return []; // recherches intermédiaires : 0 résultat (cas qui démontait la page)
    };
    const input = await renderLoaded();
    input.focus();

    // Saisit « test » en 4 frappes rapides (dans la même fenêtre de debounce).
    for (const value of ['t', 'te', 'tes', 'test']) {
      fireEvent.change(input, { target: { value } });
    }

    // Pendant la frappe : la valeur est complète et le focus n'a pas bougé.
    expect(input.value).toBe('test');
    expect(document.activeElement).toBe(input);

    // Après le debounce (300 ms) : UNE seule requête serveur, pour « test ».
    await waitFor(() => {
      expect(listCalls.filter((c) => c.search !== undefined).map((c) => c.search)).toEqual(['test']);
    }, { timeout: 2000 });

    // Les résultats de « test » s'affichent…
    await screen.findByText('Produit test');
    // …le champ est TOUJOURS le même nœud DOM (aucun remount de la page)…
    expect(screen.getByPlaceholderText(SEARCH_PLACEHOLDER)).toBe(input);
    // …avec sa valeur et son focus intacts.
    expect(input.value).toBe('test');
    expect(document.activeElement).toBe(input);
  });

  it('résultat vide puis nouvelle frappe : la page ne se démonte pas (ancien bug exact)', async () => {
    autoResolve = (search) => {
      if (!search) return [makeApiProduct('Alpha')];
      if (search === 'zz') return []; // 0 résultat → products = []
      if (search === 'zzz') return [makeApiProduct('Zorro zzz')];
      return [];
    };
    const input = await renderLoaded();
    input.focus();

    fireEvent.change(input, { target: { value: 'zz' } });
    await screen.findByText(/Aucun produit/i, undefined, { timeout: 2000 });
    // Ancien bug : la frappe suivante (loading && products.length === 0)
    // remplaçait TOUTE la page par le spinner → focus perdu.
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(document.activeElement).toBe(input);

    await screen.findByText('Zorro zzz', undefined, { timeout: 2000 });
    expect(screen.getByPlaceholderText(SEARCH_PLACEHOLDER)).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('zzz');
  });

  it('réponse obsolète ignorée : un résultat en retard ne remplace pas la dernière recherche', async () => {
    const input = await renderLoaded();
    input.focus();

    // 1re recherche « te » : requête part, mais on NE la résout pas encore.
    fireEvent.change(input, { target: { value: 'te' } });
    await waitFor(() => expect(listCalls.some((c) => c.search === 'te')).toBe(true), { timeout: 2000 });

    // 2e recherche « test » : part après, se résout AVANT la première.
    fireEvent.change(input, { target: { value: 'test' } });
    await waitFor(() => expect(listCalls.some((c) => c.search === 'test')).toBe(true), { timeout: 2000 });
    listCalls.find((c) => c.search === 'test')!.deferred
      .resolve({ data: { data: [makeApiProduct('Produit test')], meta: { total: 1 } } });
    await screen.findByText('Produit test');

    // La réponse de « te » arrive EN RETARD avec d'autres résultats → ignorée.
    listCalls.find((c) => c.search === 'te')!.deferred
      .resolve({ data: { data: [makeApiProduct('Résultat périmé')], meta: { total: 1 } } });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('Résultat périmé')).toBeNull();
    expect(screen.getByText('Produit test')).toBeTruthy();
  });

  it('réinitialiser vide la recherche et relance la liste complète', async () => {
    autoResolve = (search) => {
      if (!search) return [makeApiProduct('Alpha')];
      if (search === 'test') return [makeApiProduct('Produit test')];
      return [];
    };
    const input = await renderLoaded();
    fireEvent.change(input, { target: { value: 'test' } });
    await screen.findByText('Produit test');

    fireEvent.click(screen.getByRole('button', { name: /Réinitialiser/ }));
    await waitFor(() => expect((screen.getByPlaceholderText(SEARCH_PLACEHOLDER) as HTMLInputElement).value).toBe(''));
    await screen.findByText('Alpha');
  });
});
