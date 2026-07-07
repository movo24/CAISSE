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

  it('permet une fermeture sans comptage (logout sans montant)', () => {
    expect(src).toMatch(/logout\(\);/);
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
