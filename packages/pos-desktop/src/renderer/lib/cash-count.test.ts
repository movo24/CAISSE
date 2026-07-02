import { describe, it, expect } from 'vitest';
import { computeCashCount, parseCountedEuros } from './cash-count';

const SUMMARY = { sessionId: 's1', salesCount: 12, cashCapturedMinorUnits: 15000, totalCapturedMinorUnits: 22000 };

describe('cash-count (POS-017b)', () => {
  it('attendu = fond de caisse + espèces encaissées ; écart signé', () => {
    expect(computeCashCount(SUMMARY, 5000, 20000)).toEqual({
      expectedMinorUnits: 20000, countedMinorUnits: 20000, deltaMinorUnits: 0, status: 'exact',
    });
    expect(computeCashCount(SUMMARY, 5000, 19850).status).toBe('manquant');
    expect(computeCashCount(SUMMARY, 5000, 20100)).toMatchObject({ deltaMinorUnits: 100, status: 'excédent' });
  });

  it('fond de caisse négatif est clampé (jamais un attendu négatif)', () => {
    expect(computeCashCount(SUMMARY, -100, 15000).expectedMinorUnits).toBe(15000);
  });

  it('parseCountedEuros: virgule ok, saisie invalide → null (refus, pas de devinette)', () => {
    expect(parseCountedEuros('152,50')).toBe(15250);
    expect(parseCountedEuros('0')).toBe(0);
    expect(parseCountedEuros('abc')).toBeNull();
    expect(parseCountedEuros('-5')).toBeNull();
  });
});
