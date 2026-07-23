// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

/**
 * Porte « Nouveau produit » — deux parcours (cahier des charges codes internes
 * Wesley, 2026-07-23) :
 *  1. le produit possède un code-barres : un seul champ scan/clavier,
 *     contrôle de format + recherche immédiate de doublon (tests 1, 2, 5) ;
 *  2. le produit n'en possède pas : « Générer un code-barres Wesley » —
 *     génération SERVEUR, l'assistant s'ouvre avec le code déjà affecté et
 *     non modifiable (test 3).
 */

const scanMock = vi.fn();
const generateMock = vi.fn();

vi.mock('../services/api', () => ({
  productsApi: {
    scan: (ean: string) => scanMock(ean),
    generateInternalCode: () => generateMock(),
    listBrands: () => Promise.resolve({ data: [] }),
    listSuppliers: () => Promise.resolve({ data: [] }),
    listCategories: () => Promise.resolve({ data: [] }),
  },
  storesApi: {
    list: () => Promise.resolve({ data: [] }),
  },
}));
vi.mock('../stores/authStore', () => ({
  useAuthStore: (sel?: any) => {
    const state = { employee: { id: 'e1', role: 'admin', storeId: 'store-1' }, stores: [], currentStoreId: 'store-1' };
    return sel ? sel(state) : state;
  },
}));

import { ProductEditPage } from './ProductEditPage';

function renderGate() {
  return render(
    <MemoryRouter initialEntries={['/products/new']}>
      <Routes>
        <Route path="/products/new" element={<ProductEditPage />} />
        <Route path="/products/:id/edit" element={<div>page-edition</div>} />
        <Route path="/products" element={<div>liste</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  cleanup();
  scanMock.mockReset();
  generateMock.mockReset();
});

describe('Porte Nouveau produit — deux parcours', () => {
  it('affiche les deux choix : code-barres existant ET génération Wesley', async () => {
    renderGate();
    expect(await screen.findByText('Le produit possède un code-barres')).toBeTruthy();
    expect(screen.getByText('Le produit ne possède pas de code-barres')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Valider et continuer/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Générer un code-barres Wesley/ })).toBeTruthy();
  });

  it('saisie clavier d’un code EXISTANT → doublon détecté immédiatement (tests 2+5)', async () => {
    scanMock.mockResolvedValue({ data: { id: 'p-1', name: 'Tablette', priceMinorUnits: 250 } });
    renderGate();
    const input = await screen.findByPlaceholderText(/Scanner ou saisir le code/);
    fireEvent.change(input, { target: { value: '4006381333931' } }); // saisie clavier
    fireEvent.click(screen.getByRole('button', { name: /Valider et continuer/ }));
    expect(await screen.findByText('Ce code-barres existe déjà')).toBeTruthy();
    expect(screen.getByText(/Tablette/)).toBeTruthy();
    expect(scanMock).toHaveBeenCalledWith('4006381333931');
  });

  it('scan (Entrée) d’un code INCONNU → l’assistant s’ouvre avec le code affecté (test 1)', async () => {
    scanMock.mockRejectedValue({ response: { status: 404 } });
    renderGate();
    const input = await screen.findByPlaceholderText(/Scanner ou saisir le code/);
    // La douchette clavier-wedge tape le code puis envoie Entrée.
    fireEvent.change(input, { target: { value: '96385074' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByText('Le produit possède un code-barres')).toBeNull());
    const eanField = screen.getByDisplayValue('96385074') as HTMLInputElement;
    expect(eanField).toBeTruthy(); // fiche ouverte, code déjà affecté
  });

  it('code au format invalide → message précis, « Valider et continuer » bloqué', async () => {
    renderGate();
    const input = await screen.findByPlaceholderText(/Scanner ou saisir le code/);
    fireEvent.change(input, { target: { value: 'ABC 123' } });
    expect(await screen.findByText(/uniquement des chiffres/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Valider et continuer/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('« Générer un code-barres Wesley » → code SERVEUR affecté, champ non modifiable (test 3)', async () => {
    generateMock.mockResolvedValue({ data: { code: 'WES-P-000000000042', barcodeType: 'INTERNAL_WESLEY' } });
    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: /Générer un code-barres Wesley/ }));
    await waitFor(() => expect(screen.queryByText('Le produit ne possède pas de code-barres')).toBeNull());
    const eanField = (await screen.findByDisplayValue('WES-P-000000000042')) as HTMLInputElement;
    expect(eanField.disabled).toBe(true); // permanent, non modifiable
    expect(screen.getByText(/permanent, non modifiable/)).toBeTruthy();
    expect(generateMock).toHaveBeenCalledTimes(1); // jamais généré côté navigateur
  });

  it('échec serveur de génération → message explicite, on reste sur la porte', async () => {
    generateMock.mockRejectedValue({ response: { data: { message: 'Erreur serveur' } } });
    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: /Générer un code-barres Wesley/ }));
    expect(await screen.findByText(/Erreur serveur/)).toBeTruthy();
    expect(screen.getByText('Le produit ne possède pas de code-barres')).toBeTruthy();
  });
});
