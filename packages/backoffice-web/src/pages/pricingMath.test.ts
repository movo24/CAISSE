import { describe, it, expect } from 'vitest';
import { ttcFromHt, htFromTtc, eurosInputToMinor, minorToEurosInput, parseTaxRate } from './pricingMath';

describe('pricingMath — HT ↔ TTC (arrondi au centime)', () => {
  it('TVA 20 % : 10,00 € HT → 12,00 € TTC ; 12,00 € TTC → 10,00 € HT', () => {
    expect(ttcFromHt(1000, 20)).toBe(1200);
    expect(htFromTtc(1200, 20)).toBe(1000);
  });

  it('TVA 5,5 % : 10,00 € HT → 10,55 € TTC ; retour exact', () => {
    expect(ttcFromHt(1000, 5.5)).toBe(1055);
    expect(htFromTtc(1055, 5.5)).toBe(1000);
  });

  it('arrondit au centime (jamais de fraction de centime)', () => {
    expect(ttcFromHt(999, 5.5)).toBe(1054);      // 999 × 1,055 = 1053,945
    expect(htFromTtc(1054, 5.5)).toBe(999);
    expect(Number.isInteger(ttcFromHt(3333, 20))).toBe(true);
    expect(Number.isInteger(htFromTtc(3333, 20))).toBe(true);
  });

  it('cycle HT→TTC→HT SANS DÉRIVE — balayage exhaustif 0 à 50 000 centimes, TVA 5,5 et 20', () => {
    for (const t of [5.5, 20]) {
      for (let ht = 0; ht <= 50000; ht++) {
        const back = htFromTtc(ttcFromHt(ht, t), t);
        if (back !== ht) throw new Error(`dérive: ht=${ht} t=${t} → ${back}`);
      }
    }
  });

  it('cycle stable aussi sur TVA 2,1 et 10 (autres taux français)', () => {
    for (const t of [2.1, 10]) {
      for (let ht = 0; ht <= 20000; ht++) {
        expect(htFromTtc(ttcFromHt(ht, t), t)).toBe(ht);
      }
    }
  });

  it('saisie française : virgule et espaces acceptés, invalide → null', () => {
    expect(eurosInputToMinor('12,50')).toBe(1250);
    expect(eurosInputToMinor('1 250,99')).toBe(125099);
    expect(eurosInputToMinor('12.50')).toBe(1250);
    expect(eurosInputToMinor('abc')).toBeNull();
    expect(eurosInputToMinor('-3')).toBeNull();
  });

  it('affichage : centimes → « 12,50 »', () => {
    expect(minorToEurosInput(1250)).toBe('12,50');
    expect(minorToEurosInput(0)).toBe('0,00');
  });

  it('parseTaxRate : « 5,5 » → 5.5 ; invalide → null', () => {
    expect(parseTaxRate('5,5')).toBe(5.5);
    expect(parseTaxRate('20')).toBe(20);
    expect(parseTaxRate('')).toBeNull();
    expect(parseTaxRate('-1')).toBeNull();
  });
});
