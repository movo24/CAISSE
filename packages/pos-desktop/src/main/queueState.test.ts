import { describe, it, expect } from 'vitest';
import { parseQueueLines } from './posRawPrint';

/**
 * Lecture de l'état RÉEL des files Windows (`Get-Printer`).
 *
 * `webContents.print()` répond « success » dès la remise au spouleur : ça ne
 * prouve pas que le papier sort. Ce parseur alimente le message honnête de
 * l'écran diagnostic — il doit encaisser une sortie PowerShell réelle, bruitée.
 */

const SEP = '';
const line = (...f: string[]) => ['Q', ...f].join(SEP);

describe('parseQueueLines', () => {
  it('parse une file Star TSP143 saine', () => {
    const out = parseQueueLines(
      line('Star TSP100 Cutter (TSP143)', 'Star TSP100 Cutter (TSP143)', 'USB001', 'Normal', 'False', '0'),
    );
    expect(out).toEqual([
      {
        name: 'Star TSP100 Cutter (TSP143)',
        driverName: 'Star TSP100 Cutter (TSP143)',
        portName: 'USB001',
        status: 'Normal',
        workOffline: false,
        queuedJobs: 0,
      },
    ]);
  });

  it('parse plusieurs files et ignore le bruit PowerShell', () => {
    const stdout = [
      'WARNING: something irrelevant',
      line('Star TSP100 Cutter (TSP143)', 'Star drv', 'USB001', 'Normal', 'False', '0'),
      '',
      line('Star TSP143 (Tiroir)', 'Star drv', 'USB001', 'Normal', 'False', '2'),
      'Microsoft Print to PDF is not emitted here',
    ].join('\r\n');
    const out = parseQueueLines(stdout);
    expect(out.map((q) => q.name)).toEqual(['Star TSP100 Cutter (TSP143)', 'Star TSP143 (Tiroir)']);
    expect(out[1].queuedJobs).toBe(2);
  });

  it('WorkOffline "True" → booléen vrai (insensible à la casse)', () => {
    const out = parseQueueLines(line('P', 'd', 'USB001', 'Offline', 'true', '5'));
    expect(out[0].workOffline).toBe(true);
    expect(out[0].status).toBe('Offline');
  });

  it('nombre de jobs illisible → -1, jamais NaN', () => {
    const out = parseQueueLines(line('P', 'd', 'USB001', 'Normal', 'False', ''));
    expect(out[0].queuedJobs).toBe(-1);
  });

  it('statut vide → "Unknown" plutôt qu’une chaîne vide trompeuse', () => {
    const out = parseQueueLines(line('P', 'd', 'USB001', '', 'False', '0'));
    expect(out[0].status).toBe('Unknown');
  });

  it('ligne tronquée → ignorée (pas de file fantôme)', () => {
    expect(parseQueueLines(['Q', 'incomplet'].join(SEP))).toEqual([]);
  });

  it('nom vide → ignoré', () => {
    expect(parseQueueLines(line('', 'd', 'USB001', 'Normal', 'False', '0'))).toEqual([]);
  });

  it('sortie vide / non-Windows → tableau vide, jamais une exception', () => {
    expect(parseQueueLines('')).toEqual([]);
    expect(parseQueueLines(undefined as unknown as string)).toEqual([]);
  });
});
