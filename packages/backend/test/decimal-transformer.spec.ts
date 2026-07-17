/**
 * decimalToNumber — transformer des colonnes `decimal` de TAUX (tax_rate).
 * Le driver pg renvoie ces colonnes en string ; le transformer garantit un
 * number côté entité (bug TVA 2026-07-18 : '20.00' concaténé au lieu
 * d'additionné → TVA scellée ~100× trop faible).
 */
import { decimalToNumber } from '../src/common/utils/decimal.transformer';

describe('decimalToNumber', () => {
  it('from : string pg → number (formats entiers et décimaux)', () => {
    expect(decimalToNumber.from('20.00')).toBe(20);
    expect(decimalToNumber.from('5.50')).toBe(5.5);
    expect(decimalToNumber.from('0')).toBe(0);
    expect(decimalToNumber.from('2.10')).toBe(2.1);
  });

  it('from : number déjà normalisé → inchangé (mocks, pg-mem)', () => {
    expect(decimalToNumber.from(20)).toBe(20);
    expect(decimalToNumber.from(5.5)).toBe(5.5);
  });

  it('from : null/undefined/invalide → null, jamais NaN', () => {
    expect(decimalToNumber.from(null)).toBeNull();
    expect(decimalToNumber.from(undefined as any)).toBeNull();
    expect(decimalToNumber.from('abc' as any)).toBeNull();
  });

  it('to : écrit la valeur telle quelle (PG gère la précision)', () => {
    expect(decimalToNumber.to!(5.5)).toBe(5.5);
    expect(decimalToNumber.to!(null)).toBeNull();
  });

  it('régression : la formule TVA avec un taux string normalisé donne le bon montant', () => {
    const rate = Number(decimalToNumber.from('20.00'));
    expect(Math.round(3490 * (rate / (100 + rate)))).toBe(582); // jamais 7
  });
});
