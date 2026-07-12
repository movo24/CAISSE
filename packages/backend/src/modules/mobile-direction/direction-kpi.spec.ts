import {
  averageBasketMinorUnits,
  fillHourly,
  marginRate,
  rankStores,
  sumStoreRows,
  toInt,
  toPeriodTotals,
  variationPct,
} from './direction-kpi';
import { shiftDay } from './mobile-direction.service';

describe('direction-kpi (pure aggregators)', () => {
  describe('averageBasketMinorUnits', () => {
    it('rounds to integer centimes', () => {
      expect(averageBasketMinorUnits(1001, 2)).toBe(501);
    });

    it('is 0 (never NaN) with zero transactions', () => {
      expect(averageBasketMinorUnits(0, 0)).toBe(0);
    });
  });

  describe('variationPct', () => {
    it('computes a signed percentage rounded to 1 decimal', () => {
      expect(variationPct(1100, 1000)).toBe(10);
      expect(variationPct(950, 1000)).toBe(-5);
      expect(variationPct(1003, 3000)).toBe(-66.6);
    });

    it('is null (not 0, not Infinity) when the previous period is empty', () => {
      expect(variationPct(500, 0)).toBeNull();
      expect(variationPct(0, 0)).toBeNull();
    });
  });

  describe('sumStoreRows', () => {
    it('sums revenue and transactions across stores', () => {
      expect(
        sumStoreRows([
          { storeId: 'a', revenueMinorUnits: 100, transactionCount: 2 },
          { storeId: 'b', revenueMinorUnits: 250, transactionCount: 3 },
        ]),
      ).toEqual({ revenueMinorUnits: 350, transactionCount: 5 });
    });

    it('returns zeros on an empty network', () => {
      expect(sumStoreRows([])).toEqual({
        revenueMinorUnits: 0,
        transactionCount: 0,
      });
    });
  });

  describe('rankStores', () => {
    const s = (id: string, rev: number) => ({
      storeId: id,
      name: id,
      revenueMinorUnits: rev,
    });

    it('ranks best desc and worst asc-of-tail, zero-revenue stores included', () => {
      const { best, worst } = rankStores(
        [s('a', 500), s('b', 0), s('c', 900), s('d', 100), s('e', 300)],
      );
      expect(best.map((x) => x.storeId)).toEqual(['c', 'a', 'e']);
      expect(worst.map((x) => x.storeId)).toEqual(['b', 'd', 'e']);
    });

    it('returns no worst list when every store already fits in best', () => {
      const { best, worst } = rankStores([s('a', 1), s('b', 2)]);
      expect(best).toHaveLength(2);
      expect(worst).toEqual([]);
    });
  });

  describe('marginRate', () => {
    it('computes the rate over covered revenue', () => {
      expect(marginRate(300, 1000)).toBe(30);
    });

    it('is null when margin is unknown or revenue empty', () => {
      expect(marginRate(null, 1000)).toBeNull();
      expect(marginRate(100, 0)).toBeNull();
    });
  });

  describe('fillHourly', () => {
    it('produces a dense 24-slot series with zeros for silent hours', () => {
      const out = fillHourly([
        { hour: 9, revenueMinorUnits: 100, transactionCount: 1 },
        { hour: 18, revenueMinorUnits: 400, transactionCount: 2 },
      ]);
      expect(out).toHaveLength(24);
      expect(out[9]).toEqual({
        hour: 9,
        revenueMinorUnits: 100,
        transactionCount: 1,
      });
      expect(out[0]).toEqual({
        hour: 0,
        revenueMinorUnits: 0,
        transactionCount: 0,
      });
      expect(out[18]!.revenueMinorUnits).toBe(400);
    });
  });

  describe('toInt', () => {
    it('parses raw SQL bigint strings and tolerates null/undefined', () => {
      expect(toInt('12345')).toBe(12345);
      expect(toInt(42)).toBe(42);
      expect(toInt(null)).toBe(0);
      expect(toInt(undefined)).toBe(0);
      expect(toInt('not-a-number')).toBe(0);
    });
  });

  describe('toPeriodTotals', () => {
    it('derives the basket from revenue and count', () => {
      expect(toPeriodTotals(900, 3)).toEqual({
        revenueMinorUnits: 900,
        transactionCount: 3,
        averageBasketMinorUnits: 300,
      });
    });
  });

  describe('shiftDay', () => {
    it('shifts ISO days across month/year boundaries (UTC-safe)', () => {
      expect(shiftDay('2026-07-12', -1)).toBe('2026-07-11');
      expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31');
      expect(shiftDay('2026-02-28', 1)).toBe('2026-03-01');
      expect(shiftDay('2026-07-12', -7)).toBe('2026-07-05');
    });
  });
});
