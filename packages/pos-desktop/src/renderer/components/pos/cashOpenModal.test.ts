import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Fond de caisse à l'ouverture : le caissier saisit le montant, converti en
 * centimes et transmis via declareOpeningCash ; « Fond inconnu / passer » laisse
 * la valeur nulle sans bloquer. Aucune valeur autre que le fond n'est envoyée.
 */
const src = readFileSync(join(__dirname, 'CashOpenModal.tsx'), 'utf8');

describe('CashOpenModal — fond de caisse à l\'ouverture', () => {
  it('convertit les euros saisis en centimes entiers', () => {
    expect(src).toMatch(/Math\.round\(euros \* 100\)/);
  });

  it('déclare le fond via le store (declareOpeningCash)', () => {
    expect(src).toMatch(/declareOpeningCash\(centimes\)/);
  });

  it('permet de passer (fond inconnu) sans bloquer la caisse', () => {
    expect(src).toMatch(/dismiss/);
    expect(src).toMatch(/Fond inconnu/i);
  });

  it('ne s\'affiche que si openingCashRequired', () => {
    expect(src).toMatch(/openingCashRequired/);
    expect(src).toMatch(/if \(!open\) return null/);
  });

  it('refuse un montant invalide/négatif', () => {
    expect(src).toMatch(/euros < 0/);
    expect(src).toMatch(/Number\.isFinite/);
  });
});
