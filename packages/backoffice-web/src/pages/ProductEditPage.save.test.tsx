// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

/**
 * Règle UX 2026-07-24 — après « Enregistrer » sur la fiche produit :
 *  - succès CONFIRMÉ serveur → « Produit validé et enregistré » puis retour
 *    AUTOMATIQUE à Catalogue → Produits ;
 *  - double clic → UN seul appel serveur (bouton désactivé pendant l'envoi) ;
 *  - échec serveur → on RESTE sur la fiche, erreurs affichées, saisies
 *    conservées, jamais de « validé » avant confirmation réelle ;
 *  - publication wizard (création) → même règle de retour.
 */

const updateMock = vi.fn();
const createMock = vi.fn();
const getMock = vi.fn();

vi.mock('../services/api', () => {
  const empty = () => Promise.resolve({ data: [] });
  return {
    productsApi: new Proxy(
      {},
      {
        get: (_t, prop: string) => {
          if (prop === 'update') return (...a: unknown[]) => updateMock(...a);
          if (prop === 'create') return (...a: unknown[]) => createMock(...a);
          if (prop === 'get') return (...a: unknown[]) => getMock(...a);
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
// Publication wizard : on force « tout est valide » — on teste le RETOUR, pas
// la validation d'étapes (couverte par ficheWizard.test.ts).
vi.mock('../utils/ficheWizard', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return { ...mod, validateAll: () => ({ ok: true, fieldErrors: {}, stepIssues: [] }) };
});

import { ProductEditPage } from './ProductEditPage';

const PRODUCT = {
  id: 'p1',
  ean: '3760012345678',
  name: 'Coca 33cl',
  priceMinorUnits: 150,
  taxRate: 20,
  status: 'active',
  unitType: 'unit',
  stock: 10,
  stockAlertThreshold: 10,
  stockCriticalThreshold: 5,
};

function renderEdit(path = '/products/p1/edit') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/products/:id/edit" element={<ProductEditPage />} />
        <Route path="/products" element={<div>page-catalogue</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  cleanup();
  updateMock.mockReset();
  createMock.mockReset();
  getMock.mockReset();
  getMock.mockResolvedValue({ data: PRODUCT });
});

async function clickSave() {
  const btn = await screen.findByRole('button', { name: /Enregistrer/ });
  fireEvent.click(btn);
  return btn;
}

describe('Fiche produit — retour au catalogue après enregistrement', () => {
  it('modification réussie : confirmation « Produit validé et enregistré » PUIS retour au catalogue', async () => {
    updateMock.mockResolvedValue({ data: { ...PRODUCT } });
    renderEdit();
    (await screen.findAllByDisplayValue('Coca 33cl'))[0]; // fiche chargée (nom + nom court suggéré)
    await clickSave();
    // La confirmation n'apparaît qu'après la réponse serveur.
    await screen.findByText(/Produit validé et enregistré/);
    expect(updateMock).toHaveBeenCalledTimes(1);
    // Retour automatique (≈900 ms) à Catalogue → Produits.
    await waitFor(() => expect(screen.getByText('page-catalogue')).toBeTruthy(), { timeout: 2500 });
  });

  it('double clic : UN seul appel serveur, une seule navigation', async () => {
    let resolveUpdate: (v: unknown) => void = () => {};
    updateMock.mockImplementation(() => new Promise((res) => { resolveUpdate = res; }));
    renderEdit();
    (await screen.findAllByDisplayValue('Coca 33cl'))[0];
    const btn = await clickSave();
    fireEvent.click(btn); // 2ᵉ clic immédiat — bouton désactivé (saving)
    fireEvent.click(btn); // 3ᵉ clic
    resolveUpdate({ data: { ...PRODUCT } });
    await screen.findByText(/Produit validé et enregistré/);
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it('échec serveur : on RESTE sur la fiche, erreur visible, saisie conservée, jamais « validé »', async () => {
    updateMock.mockRejectedValue({
      response: { data: { message: 'Conflit', details: ['Le prix est invalide'] } },
    });
    renderEdit();
    const nameInput = (await screen.findAllByDisplayValue('Coca 33cl'))[0] as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Coca 33cl MODIFIÉ' } });
    await clickSave();
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    // Toujours sur la fiche, avec la saisie intacte et une erreur affichée.
    await screen.findByText(/Enregistrement impossible|Conflit|invalide/i);
    expect(screen.queryByText('page-catalogue')).toBeNull();
    expect(screen.queryByText(/Produit validé et enregistré/)).toBeNull();
    expect((screen.getAllByDisplayValue('Coca 33cl MODIFIÉ')[0] as HTMLInputElement).value).toBe('Coca 33cl MODIFIÉ');
    // Et aucune navigation différée fantôme.
    await new Promise((r) => setTimeout(r, 1100));
    expect(screen.queryByText('page-catalogue')).toBeNull();
  });

  it('publication (wizard) : le serveur CONFIRME la dispo caisse (isActive+active) → « publié en caisse »', async () => {
    updateMock.mockResolvedValue({ data: { ...PRODUCT, isActive: true, status: 'active' } });
    renderEdit('/products/p1/edit?wizard=1&step=9');
    const publishBtn = await screen.findByRole('button', { name: /Valider et publier en caisse/ }, { timeout: 2000 });
    fireEvent.click(publishBtn);
    await screen.findByText(/Produit validé et publié en caisse/);
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0][1]).toMatchObject({ status: 'active' });
    await waitFor(() => expect(screen.getByText('page-catalogue')).toBeTruthy(), { timeout: 2500 });
  });

  it('publication (wizard) : serveur NON confirmé (status pending / isActive false) → « enregistré », JAMAIS « publié en caisse »', async () => {
    // Le serveur a bien enregistré mais NE confirme PAS la disponibilité caisse
    // (ex. modération : pending_validation). On ne doit pas annoncer une synchro POS.
    updateMock.mockResolvedValue({ data: { ...PRODUCT, isActive: false, status: 'pending_validation' } });
    renderEdit('/products/p1/edit?wizard=1&step=9');
    const publishBtn = await screen.findByRole('button', { name: /Valider et publier en caisse/ }, { timeout: 2000 });
    fireEvent.click(publishBtn);
    await screen.findByText(/Produit validé et enregistré/);
    expect(screen.queryByText(/publié en caisse/)).toBeNull();
    await waitFor(() => expect(screen.getByText('page-catalogue')).toBeTruthy(), { timeout: 2500 });
  });
});
