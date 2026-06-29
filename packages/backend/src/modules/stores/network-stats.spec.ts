import { aggregateNetworkTotals, isTimeWinActive } from './network-stats';

describe('POS stores network-stats', () => {
  describe('aggregateNetworkTotals', () => {
    it('sums and computes avg ticket', () => {
      const r = aggregateNetworkTotals([
        { totalRevenue: 1000, totalSales: 4, todayRevenue: 200, todaySales: 1 },
        { totalRevenue: 500, totalSales: 1, todayRevenue: 0, todaySales: 0 },
      ]);
      expect(r.totalRevenue).toBe(1500);
      expect(r.totalSales).toBe(5);
      expect(r.avgTicket).toBe(300); // round(1500/5)
      expect(r.todayRevenue).toBe(200);
      expect(r.todaySales).toBe(1);
    });
    it('empty → zeros, no division by zero', () => {
      const r = aggregateNetworkTotals([]);
      expect(r).toEqual({
        totalRevenue: 0,
        totalSales: 0,
        avgTicket: 0,
        todayRevenue: 0,
        todaySales: 0,
      });
    });
  });

  describe('isTimeWinActive', () => {
    it('only ACTIVE maps to true', () => {
      expect(isTimeWinActive('ACTIVE')).toBe(true);
      expect(isTimeWinActive('INACTIVE')).toBe(false);
      expect(isTimeWinActive(null)).toBe(false);
    });
  });
});
