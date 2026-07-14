// P366 — formats d'affichage. Verrouille la règle « aucune donnée
// inventée » : null/undefined → « Donnée indisponible » ou « — »,
// jamais 0 € fabriqué. Montants = centimes entiers.

import { describe, expect, it } from 'vitest';
import {
  formatInt,
  formatMoney,
  formatMoneyCompact,
  formatPct,
  formatSince,
  trendOf,
  UNAVAILABLE,
} from './format';

const nbsp = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

describe('formatMoney', () => {
  it('convertit les centimes entiers en euros affichés', () => {
    expect(nbsp(formatMoney(123456))).toBe('1 234,56 €');
    expect(nbsp(formatMoney(0))).toBe('0,00 €');
    expect(nbsp(formatMoney(-2500))).toBe('-25,00 €');
  });
  it('respecte la devise du magasin', () => {
    expect(formatMoney(1000, 'USD')).toContain('$');
  });
  it('null/undefined/NaN → « Donnée indisponible », jamais 0 fabriqué', () => {
    expect(formatMoney(null)).toBe(UNAVAILABLE);
    expect(formatMoney(undefined)).toBe(UNAVAILABLE);
    expect(formatMoney(Number.NaN)).toBe(UNAVAILABLE);
  });
});

describe('formatMoneyCompact', () => {
  it('reste précis sous 10 000 € et compacte au-delà', () => {
    expect(nbsp(formatMoneyCompact(999_999))).toBe('9 999,99 €');
    expect(formatMoneyCompact(1_240_000)).toMatch(/k\s?€|k€/);
  });
  it('null → indisponible', () => {
    expect(formatMoneyCompact(null)).toBe(UNAVAILABLE);
  });
});

describe('formatPct / trendOf', () => {
  it('signe explicite et null → « — » (pas de baseline)', () => {
    expect(nbsp(formatPct(12.5))).toBe('+12,5 %');
    expect(nbsp(formatPct(-3.2))).toBe('-3,2 %');
    expect(formatPct(null)).toBe('—');
  });
  it('tendance : up/down/flat/none', () => {
    expect(trendOf(5)).toBe('up');
    expect(trendOf(-5)).toBe('down');
    expect(trendOf(0)).toBe('flat');
    expect(trendOf(null)).toBe('none');
  });
});

describe('formatInt', () => {
  it('null → indisponible', () => {
    expect(formatInt(null)).toBe(UNAVAILABLE);
    expect(nbsp(formatInt(12345))).toBe('12 345');
  });
});

describe('formatSince — horodatage de dernière synchro', () => {
  const now = new Date('2026-07-14T12:00:00Z');
  it('gradations minute / heure, jamais de futur', () => {
    expect(formatSince('2026-07-14T11:59:40Z', now)).toBe("à l'instant");
    expect(formatSince('2026-07-14T11:55:00Z', now)).toBe('il y a 5 min');
    expect(formatSince('2026-07-14T09:00:00Z', now)).toBe('il y a 3 h');
  });
  it('null ou invalide → « jamais »', () => {
    expect(formatSince(null, now)).toBe('jamais');
    expect(formatSince('n/a', now)).toBe('jamais');
  });
});
