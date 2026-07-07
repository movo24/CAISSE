import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Comptage caisse à la fermeture : le caissier saisit UNIQUEMENT le compté.
 * L'attendu et l'écart sont calculés côté serveur — la modale ne doit jamais
 * afficher un champ « attendu » modifiable ni envoyer autre chose que le compté.
 */
const src = readFileSync(join(__dirname, 'CashCountModal.tsx'), 'utf8');

describe('CashCountModal — compté uniquement, attendu serveur', () => {
  it('convertit les euros saisis en centimes (entiers)', () => {
    expect(src).toMatch(/Math\.round\(euros \* 100\)/);
  });

  it('ne transmet que le compté au serveur (logout(centimes))', () => {
    expect(src).toMatch(/logout\(centimes\)/);
  });

  it('exige un motif (≥ 3 car.) pour fermer sans compter', () => {
    expect(src).toMatch(/skipReason\.trim\(\)\.length >= 3/);
    expect(src).toMatch(/obligatoire pour fermer sans compter/i);
  });

  it('transmet le motif de skip au serveur (logout(undefined, motif))', () => {
    expect(src).toMatch(/logout\(undefined, skipReason\.trim\(\)\)/);
  });

  it('désactive la confirmation de skip sans motif valide', () => {
    expect(src).toMatch(/disabled=\{skipMode && !skipReasonOk\}/);
  });

  it('ne contient AUCUN champ de saisie « attendu »/expected éditable', () => {
    // Le mot « attendu » n'apparaît que dans le texte explicatif, jamais comme
    // valeur envoyée : aucune clé expected/attendu poussée vers l'API.
    expect(src).not.toMatch(/expectedCashMinorUnits\s*:/);
    expect(src).not.toMatch(/close\([^)]*expected/i);
  });

  it('refuse un montant invalide ou négatif avant de fermer', () => {
    expect(src).toMatch(/euros < 0/);
    expect(src).toMatch(/Number\.isFinite/);
  });
});
