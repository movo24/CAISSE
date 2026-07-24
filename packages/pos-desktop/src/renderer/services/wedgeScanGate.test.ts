import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shouldAcceptWedgeScan, type WedgeScanUiState } from './wedgeScanGate';

const shopping: WedgeScanUiState = {
  hasActiveCashier: true,
  paymentModalOpen: false,
  confirmationOpen: false,
  unknownProductOpen: false,
  weightModalOpen: false,
  emailModalOpen: false,
};

describe('shouldAcceptWedgeScan', () => {
  it('état achat normal (caissier actif, aucune modale) → accepte', () => {
    expect(shouldAcceptWedgeScan(shopping)).toBe(true);
  });

  it('sans caissier actif → refuse', () => {
    expect(shouldAcceptWedgeScan({ ...shopping, hasActiveCashier: false })).toBe(false);
  });

  it('pendant le paiement → refuse (un scan ne doit pas ajouter au panier)', () => {
    expect(shouldAcceptWedgeScan({ ...shopping, paymentModalOpen: true })).toBe(false);
  });

  it('pendant l’overlay de confirmation → refuse', () => {
    expect(shouldAcceptWedgeScan({ ...shopping, confirmationOpen: true })).toBe(false);
  });

  it('modale produit inconnu ouverte → refuse', () => {
    expect(shouldAcceptWedgeScan({ ...shopping, unknownProductOpen: true })).toBe(false);
  });

  it('saisie de poids en cours → refuse', () => {
    expect(shouldAcceptWedgeScan({ ...shopping, weightModalOpen: true })).toBe(false);
  });

  it('modale e-mail ouverte → refuse', () => {
    expect(shouldAcceptWedgeScan({ ...shopping, emailModalOpen: true })).toBe(false);
  });

  it('plusieurs modales cumulées → refuse', () => {
    expect(
      shouldAcceptWedgeScan({ ...shopping, paymentModalOpen: true, confirmationOpen: true }),
    ).toBe(false);
  });
});

describe('POSPage — câblage de la douchette wedge globale (source guards)', () => {
  const posPage = readFileSync(join(__dirname, '..', 'pages', 'POSPage.tsx'), 'utf8');

  it('le listener global est abonné une seule fois (startBarcodeListener + cleanup)', () => {
    expect(posPage).toMatch(/peripheralBridge\.startBarcodeListener\(/);
    expect(posPage).toMatch(/const off = peripheralBridge\.startBarcodeListener/);
  });

  it('les scans globaux sont filtrés par shouldAcceptWedgeScan, dédoublonnés, puis routés vers handleScan', () => {
    expect(posPage).toMatch(/shouldAcceptWedgeScan\(\{/);
    // Le refus de la gate reste un retour immédiat (tracé, jamais silencieux).
    expect(posPage).toMatch(/if \(!accept\) \{\s*scanTrace\('ignored_gate', code\);\s*return;/);
    expect(posPage).toMatch(/isDuplicateScan\(lastWedgeScan\.current, code, now\)/);
    // Le scan douchette est routé avec sa SOURCE ('wedge') → même logique que le
    // champ manuel, mais sans raccourci « résultat de recherche sélectionné ».
    expect(posPage).toMatch(/void handleScan\(code, 'wedge'\)/);
  });
});
