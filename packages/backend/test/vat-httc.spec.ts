/**
 * HT ↔ TTC bidirectionnel (logique pure, `@caisse/shared/utils/money`).
 * Couvre : valeurs connues, invariant HT+TVA=TTC (2 sens), arrondis au centime,
 * formatage virgule française, et CYCLE SANS DÉRIVE (aller-retour répété stable).
 */
import { htToTtc, ttcToHt, formatMoney } from '../../../shared/utils/money';

const RATES_FR = [0, 2.1, 5.5, 10, 20]; // taux TVA France

describe('HT ↔ TTC — valeurs connues', () => {
  it('HT → TTC (20 %)', () => {
    expect(htToTtc(1000, 20)).toEqual({ htMinorUnits: 1000, taxMinorUnits: 200, ttcMinorUnits: 1200 });
  });
  it('TTC → HT (20 %)', () => {
    expect(ttcToHt(1200, 20)).toEqual({ htMinorUnits: 1000, taxMinorUnits: 200, ttcMinorUnits: 1200 });
  });
  it('HT → TTC (5,5 %)', () => {
    // 1000 * 1.055 = 1055 pile
    expect(htToTtc(1000, 5.5)).toEqual({ htMinorUnits: 1000, taxMinorUnits: 55, ttcMinorUnits: 1055 });
  });
  it('TTC → HT (10 %)', () => {
    // 1100 / 1.10 = 1000
    expect(ttcToHt(1100, 10)).toEqual({ htMinorUnits: 1000, taxMinorUnits: 100, ttcMinorUnits: 1100 });
  });
  it('taux 0 % = identité', () => {
    expect(htToTtc(1999, 0)).toEqual({ htMinorUnits: 1999, taxMinorUnits: 0, ttcMinorUnits: 1999 });
    expect(ttcToHt(1999, 0)).toEqual({ htMinorUnits: 1999, taxMinorUnits: 0, ttcMinorUnits: 1999 });
  });
});

describe('HT ↔ TTC — arrondis au centime (demi vers le haut)', () => {
  it('HT 199 @ 5,5 % → 199*1.055 = 209.945 → 210', () => {
    expect(htToTtc(199, 5.5).ttcMinorUnits).toBe(210);
    expect(htToTtc(199, 5.5).taxMinorUnits).toBe(11);
  });
  it('TTC 105 @ 5,5 % → 105/1.055 = 99.526… → 100 HT, 5 TVA', () => {
    expect(ttcToHt(105, 5.5)).toEqual({ htMinorUnits: 100, taxMinorUnits: 5, ttcMinorUnits: 105 });
  });
  it('demi exact arrondi vers le haut (x.5 → x+1)', () => {
    // 10 @ 5% = 10.5 → 11
    expect(htToTtc(10, 5).ttcMinorUnits).toBe(11);
  });
});

describe('HT ↔ TTC — invariant ht + tax === ttc (les deux sens)', () => {
  it('tient pour une large plage × taux France', () => {
    for (const rate of RATES_FR) {
      for (let v = 0; v <= 5000; v += 7) {
        const a = htToTtc(v, rate);
        expect(a.htMinorUnits + a.taxMinorUnits).toBe(a.ttcMinorUnits);
        const b = ttcToHt(v, rate);
        expect(b.htMinorUnits + b.taxMinorUnits).toBe(b.ttcMinorUnits);
      }
    }
  });
});

describe('HT ↔ TTC — formatage virgule française', () => {
  it('formatMoney rend la virgule + € (fr)', () => {
    const ttc = htToTtc(1000, 20).ttcMinorUnits; // 1200 centimes
    expect(formatMoney(ttc, 'EUR')).toBe('12,00 €');
    expect(formatMoney(htToTtc(199, 5.5).ttcMinorUnits, 'EUR')).toBe('2,10 €');
    expect(formatMoney(1234567, 'EUR')).toBe('12 345,67 €'); // séparateur milliers = espace
  });
});

describe('HT ↔ TTC — CYCLE SANS DÉRIVE (aller-retour répété)', () => {
  it('atteint un point fixe dès le 2e cycle et ne dérive plus (≤ 1 centime, 1000 itérations)', () => {
    // (L'invariant ht+tax===ttc à chaque pas est couvert par le describe dédié ci-dessus ;
    //  ici on prouve la NON-DÉRIVE : point fixe atteint tôt puis stable sur 1000 cycles.)
    for (const rate of RATES_FR) {
      for (let ht0 = 1; ht0 <= 3000; ht0 += 13) {
        let cur = ht0;
        let afterCycle2 = -1;
        for (let i = 1; i <= 1000; i++) {
          cur = ttcToHt(htToTtc(cur, rate).ttcMinorUnits, rate).htMinorUnits;
          if (i === 2) afterCycle2 = cur;
        }
        // stable : aucune dérive entre le cycle 2 et le cycle 1000
        expect(cur).toBe(afterCycle2);
        // borné : jamais plus d'1 centime d'écart avec le HT initial
        expect(Math.abs(cur - ht0)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('depuis TTC : aller-retour TTC→HT→TTC est un point fixe exact', () => {
    for (const rate of RATES_FR) {
      for (let ttc0 = 0; ttc0 <= 3000; ttc0 += 11) {
        const ht = ttcToHt(ttc0, rate).htMinorUnits;
        const ttc1 = htToTtc(ht, rate).ttcMinorUnits;
        const ttc2 = htToTtc(ttcToHt(ttc1, rate).htMinorUnits, rate).ttcMinorUnits;
        expect(ttc2).toBe(ttc1); // stabilisé, plus aucune dérive
      }
    }
  });
});
