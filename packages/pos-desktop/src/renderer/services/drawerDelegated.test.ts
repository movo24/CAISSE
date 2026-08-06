// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decideDrawerPath } from './drawerStrategy';

/**
 * Tiroir géré par le PILOTE (futurePRNT Peripheral Unit Control).
 *
 * Terrain : le tiroir s'ouvre physiquement alors que la caisse, en `auto` sur
 * une Star raster sans file dédiée, n'envoie AUCUNE commande — c'est donc le
 * pilote qui l'ouvre. Le message « Tiroir NON ouvert » était une fausse alerte.
 * Ni succès revendiqué à tort, ni échec inventé : on nomme la délégation.
 */
describe('stratégie « géré par le pilote »', () => {
  it('ne produit ni raw, ni queue, ni refus', () => {
    const d = decideDrawerPath('star-raster', 'driver', null);
    expect(d.path).toBe('delegated');
  });

  it('explique que la caisse n’envoie aucune commande', () => {
    const d = decideDrawerPath('star-raster', 'driver', null);
    if (d.path !== 'delegated') throw new Error('unreachable');
    expect(d.reason).toMatch(/aucune commande/i);
    expect(d.reason).toMatch(/pilote Star/i);
  });

  it('s’applique quel que soit le driver détecté (choix opérateur explicite)', () => {
    for (const mode of ['star-raster', 'escpos', 'unknown', 'star-prnt-iv'] as const) {
      expect(decideDrawerPath(mode, 'driver', null).path).toBe('delegated');
    }
  });

  it('ignore une file tiroir configurée (elle devient inutile)', () => {
    expect(decideDrawerPath('star-raster', 'driver', 'Star TSP143 (Tiroir)').path).toBe('delegated');
  });
});

describe('non-régression des autres stratégies', () => {
  it('auto + star raster sans file → refus inchangé', () => {
    expect(decideDrawerPath('star-raster', 'auto', null).path).toBe('refuse');
  });
  it('auto + ESC/POS réel → kick brut inchangé', () => {
    expect(decideDrawerPath('escpos', 'auto', null).path).toBe('raw');
  });
  it('file dédiée toujours honorée', () => {
    expect(decideDrawerPath('star-raster', 'drawer_queue', 'F').path).toBe('queue');
  });
});

describe('isolation impression / tiroir (déjà en place — verrouillée)', () => {
  const sale = readFileSync(join(__dirname, 'salePeripherals.ts'), 'utf8');
  const pay = readFileSync(join(__dirname, '..', 'hooks', 'usePayment.ts'), 'utf8');

  it('l’impression a lieu AVANT le tiroir', () => {
    expect(sale.indexOf('printTicket(ticketData')).toBeLessThan(sale.indexOf('openCashDrawer()'));
  });

  it('l’appel tiroir de usePayment est détaché ET son rejet avalé', () => {
    expect(pay).toMatch(/setTimeout\(\(\) => \{[\s\S]{0,200}openCashDrawer\(\)\.catch\(/);
  });

  it('le tiroir ne conditionne jamais le statut d’impression', () => {
    expect(sale).toMatch(/printStatus = ok \? 'printed' : 'print_failed'/);
    expect(sale).not.toMatch(/printStatus =[^\n]*drawer/i);
  });
});
