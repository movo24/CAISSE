import {
  periodDays,
  unitsPerDayRate,
  perDayMinor,
  marginPercentOf,
  deltaPct,
} from './product-analytics';

const DAY = 86400000;

describe('POS products product-analytics', () => {
  describe('periodDays', () => {
    it('ceils and floors at 1', () => {
      expect(periodDays(0, 3 * DAY)).toBe(3);
      expect(periodDays(0, 0)).toBe(1);
      expect(periodDays(0, DAY * 2.2)).toBe(3); // ceil
    });
  });

  describe('unitsPerDayRate', () => {
    it('2-decimal rounding', () => {
      expect(unitsPerDayRate(10, 3)).toBe(3.33);
      expect(unitsPerDayRate(10, 2)).toBe(5);
    });
  });

  describe('perDayMinor', () => {
    it('integer centimes', () => {
      expect(perDayMinor(1000, 3)).toBe(333);
    });
  });

  describe('marginPercentOf', () => {
    it('computes 2-decimal margin %', () => {
      expect(marginPercentOf(200, 50)).toBe(75);
      expect(marginPercentOf(300, 100)).toBe(66.67);
    });
    it('null when price <= 0', () => {
      expect(marginPercentOf(0, 10)).toBeNull();
    });
  });

  describe('deltaPct', () => {
    it('2-decimal delta', () => {
      expect(deltaPct(150, 100)).toBe(50);
      expect(deltaPct(90, 100)).toBe(-10);
    });
    it('null when previous 0', () => {
      expect(deltaPct(5, 0)).toBeNull();
    });
  });
});
