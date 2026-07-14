import {
  avgTicketsPerDay,
  avgRevenuePerDay,
  avgBasket,
  rushThreshold,
  isRush,
  RUSH_THRESHOLD_MULTIPLIER,
} from './temporal-pattern';

describe('POS sales-ai temporal-pattern', () => {
  describe('avgTicketsPerDay', () => {
    it('1-decimal rounding', () => {
      expect(avgTicketsPerDay(10, 3)).toBe(3.3);
      expect(avgTicketsPerDay(10, 4)).toBe(2.5);
    });
  });

  describe('avgRevenuePerDay', () => {
    it('integer centimes', () => {
      expect(avgRevenuePerDay(1000, 3)).toBe(333);
    });
  });

  describe('avgBasket', () => {
    it('revenue per ticket', () => {
      expect(avgBasket(1000, 4)).toBe(250);
    });
    it('0 when no tickets', () => {
      expect(avgBasket(1000, 0)).toBe(0);
    });
  });

  describe('rushThreshold / isRush', () => {
    it('multiplier is 1.5', () => {
      expect(RUSH_THRESHOLD_MULTIPLIER).toBe(1.5);
    });
    it('scales mean by multiplier', () => {
      // avgTicketsGlobal=20, hourCount=10 → mean 2 → *1.5 = 3
      expect(rushThreshold(20, 10)).toBe(3);
    });
    it('rush when above threshold', () => {
      expect(isRush(4, 3)).toBe(true);
      expect(isRush(3, 3)).toBe(false);
    });
  });
});
