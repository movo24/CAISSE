/**
 * Stratégie tiroir — décision PURE selon le mode réel du driver Windows.
 *
 * Invariant central (incident terrain TSP143/futurePRNT) : JAMAIS d'ESC/POS
 * brut vers une imprimante raster détectée en mode automatique — tiroir muet,
 * jobs d'impression corrompus, risque « tiroir en boucle ».
 */
import { describe, it, expect } from 'vitest';
import { classifyPrinterMode, decideDrawerPath, printerModeLabel } from './drawerStrategy';

describe('classifyPrinterMode', () => {
  it('détecte la série TSP100/TSP143 futurePRNT comme raster hôte', () => {
    expect(classifyPrinterMode('Star TSP100 Cutter (TSP143)')).toBe('star-raster');
    expect(classifyPrinterMode('Star TSP143IIIU')).toBe('star-raster');
    expect(classifyPrinterMode('Star futurePRNT TSP113')).toBe('star-raster');
  });

  it('détecte la TSP100IV (StarPRNT / émulation ESC/POS) AVANT le motif TSP100', () => {
    expect(classifyPrinterMode('Star TSP100IV')).toBe('star-prnt-iv');
    expect(classifyPrinterMode('Star TSP143IV')).toBe('star-prnt-iv');
    expect(classifyPrinterMode('StarPRNT Driver')).toBe('star-prnt-iv');
  });

  it('détecte les drivers ESC/POS classiques', () => {
    expect(classifyPrinterMode('EPSON TM-T20III Receipt')).toBe('escpos');
    expect(classifyPrinterMode('Generic / Text Only')).toBe('escpos');
    expect(classifyPrinterMode('POS-80 ESC/POS')).toBe('escpos');
  });

  it('driver vide ou inconnu → unknown', () => {
    expect(classifyPrinterMode('')).toBe('unknown');
    expect(classifyPrinterMode(null)).toBe('unknown');
    expect(classifyPrinterMode(undefined)).toBe('unknown');
    expect(classifyPrinterMode('HP LaserJet 1020')).toBe('unknown');
  });

  it('chaque mode a un libellé humain', () => {
    for (const mode of ['star-raster', 'star-prnt-iv', 'escpos', 'unknown'] as const) {
      expect(printerModeLabel(mode).length).toBeGreaterThan(0);
    }
  });
});

describe('decideDrawerPath', () => {
  it('AUTO + raster : refuse HONNÊTEMENT sans file configurée (jamais de RAW aveugle)', () => {
    const d = decideDrawerPath('star-raster', 'auto', null);
    expect(d.path).toBe('refuse');
    if (d.path === 'refuse') expect(d.reason).toMatch(/futurePRNT|raster/i);
  });

  it('AUTO + raster + file configurée : passe par la file tiroir', () => {
    expect(decideDrawerPath('star-raster', 'auto', 'Star TSP143 (Tiroir)')).toEqual({
      path: 'queue',
      queueName: 'Star TSP143 (Tiroir)',
    });
  });

  it('AUTO + ESC/POS ou inconnu : kick RAW (comportement historique conservé)', () => {
    expect(decideDrawerPath('escpos', 'auto', null)).toEqual({ path: 'raw' });
    expect(decideDrawerPath('star-prnt-iv', 'auto', null)).toEqual({ path: 'raw' });
    expect(decideDrawerPath('unknown', 'auto', null)).toEqual({ path: 'raw' });
  });

  it('choix opérateur EXPLICITE raw_escpos : respecté quel que soit le mode', () => {
    expect(decideDrawerPath('star-raster', 'raw_escpos', null)).toEqual({ path: 'raw' });
  });

  it('choix drawer_queue sans nom de file : refus expliqué', () => {
    const d = decideDrawerPath('escpos', 'drawer_queue', '  ');
    expect(d.path).toBe('refuse');
  });

  it('choix drawer_queue avec file : queue, nom nettoyé', () => {
    expect(decideDrawerPath('unknown', 'drawer_queue', '  Ma File  ')).toEqual({
      path: 'queue',
      queueName: 'Ma File',
    });
  });
});
