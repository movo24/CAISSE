import { describe, it, expect } from 'vitest';
import { pickGraphicPrinter } from './drawerStrategy';

/**
 * Le poste expose PLUSIEURS files Star. « Star TSP100 Cutter (TSP143) » est la
 * file GRAPHIQUE — « Cutter » est le nom de modèle (TSP100 avec massicot), pas
 * un endpoint de commande. « Star TSP143 (Tiroir) » est la file créée pour le
 * tiroir : lui envoyer un ticket ne produirait qu'une impulsion et quelques
 * millimètres de papier.
 */
const MAIN = 'Star TSP100 Cutter (TSP143)';
const DRAWER = 'Star TSP143 (Tiroir)';

describe('pickGraphicPrinter', () => {
  it('choisit la file graphique, jamais la file tiroir configurée', () => {
    expect(pickGraphicPrinter([DRAWER, MAIN], DRAWER)).toBe(MAIN);
  });

  it('« Cutter » n’est PAS traité comme une file tiroir (nom de modèle)', () => {
    expect(pickGraphicPrinter([MAIN], null)).toBe(MAIN);
  });

  it('écarte une file nommée « Tiroir » même sans configuration', () => {
    expect(pickGraphicPrinter([DRAWER, MAIN], null)).toBe(MAIN);
  });

  it('écarte aussi « drawer » et « cash drawer » (postes anglophones)', () => {
    expect(pickGraphicPrinter(['Star Drawer', MAIN], null)).toBe(MAIN);
    expect(pickGraphicPrinter(['Cash Drawer Port', MAIN], null)).toBe(MAIN);
  });

  it('ordre indifférent : la graphique gagne même en 2ᵉ position', () => {
    expect(pickGraphicPrinter([DRAWER, 'Autre Tiroir', MAIN], DRAWER)).toBe(MAIN);
  });

  it('aucune imprimante → null (jamais une chaîne vide)', () => {
    expect(pickGraphicPrinter([], null)).toBeNull();
  });

  it('QUE des files tiroir → rend la première plutôt que rien (l’opérateur tranche)', () => {
    expect(pickGraphicPrinter([DRAWER], DRAWER)).toBe(DRAWER);
  });

  it('la comparaison à la file configurée ignore casse et espaces de bord', () => {
    expect(pickGraphicPrinter(['  star tsp143 (tiroir)  ', MAIN], DRAWER)).toBe(MAIN);
  });
});
