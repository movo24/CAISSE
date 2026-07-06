import {
  enumerateDates,
  isValidDateString,
  aggregatePeriod,
  dayInTimeZone,
  zonedRangeToUtc,
  MAX_RANGE_DAYS,
  type RawSale,
} from './period-summary.util';

// Helper: a completed sale at a given Paris-local day/time.
const sale = (isoUtc: string, total: number, tax: number, discount: number, payments: [string, number][]): RawSale => ({
  createdAt: isoUtc,
  totalMinorUnits: total,
  taxTotalMinorUnits: tax,
  discountTotalMinorUnits: discount,
  payments: payments.map(([method, amountMinorUnits]) => ({ method, amountMinorUnits })),
});

describe('isValidDateString', () => {
  it('accepts valid dates and rejects junk', () => {
    expect(isValidDateString('2026-07-01')).toBe(true);
    expect(isValidDateString('2026-02-29')).toBe(false); // not a leap year
    expect(isValidDateString('2026-13-01')).toBe(false);
    expect(isValidDateString('2026-7-1')).toBe(false);
    expect(isValidDateString('nope')).toBe(false);
  });
});

describe('enumerateDates', () => {
  it('returns an inclusive list for a range', () => {
    expect(enumerateDates('2026-07-01', '2026-07-06')).toEqual([
      '2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05', '2026-07-06',
    ]);
  });

  it('returns a single date when start === end', () => {
    expect(enumerateDates('2026-07-06', '2026-07-06')).toEqual(['2026-07-06']);
  });

  it('throws when end < start', () => {
    expect(() => enumerateDates('2026-07-06', '2026-07-01')).toThrow(/antérieure/);
  });

  it('throws on invalid input and on an over-long range', () => {
    expect(() => enumerateDates('bad', '2026-07-01')).toThrow(/invalide/);
    expect(() => enumerateDates('2020-01-01', '2026-07-01')).toThrow(new RegExp(`max ${MAX_RANGE_DAYS}`));
  });
});

describe('dayInTimeZone (Europe/Paris)', () => {
  it('buckets a late-evening UTC instant into the correct Paris day', () => {
    // 2026-07-01 23:30 UTC = 2026-07-02 01:30 Paris (summer, +2)
    expect(dayInTimeZone('2026-07-01T23:30:00Z', 'Europe/Paris')).toBe('2026-07-02');
    // 2026-07-01 21:30 UTC = 2026-07-01 23:30 Paris
    expect(dayInTimeZone('2026-07-01T21:30:00Z', 'Europe/Paris')).toBe('2026-07-01');
  });
});

describe('zonedRangeToUtc', () => {
  it('maps a Paris day range to a half-open UTC window (summer +2)', () => {
    const { gte, lt } = zonedRangeToUtc('2026-07-01', '2026-07-06', 'Europe/Paris');
    expect(gte.toISOString()).toBe('2026-06-30T22:00:00.000Z'); // 01 Jul 00:00 Paris
    expect(lt.toISOString()).toBe('2026-07-06T22:00:00.000Z'); // 07 Jul 00:00 Paris
  });
});

describe('aggregatePeriod', () => {
  it('single-day range produces a one-day report equal to that day', () => {
    const res = aggregatePeriod({
      completed: [
        sale('2026-07-06T09:00:00Z', 1200, 200, 0, [['card', 1200]]),
        sale('2026-07-06T10:00:00Z', 800, 133, 100, [['cash', 800]]),
      ],
      voided: [],
      startDate: '2026-07-06',
      endDate: '2026-07-06',
    });
    expect(res.isSingleDay).toBe(true);
    expect(res.dayCount).toBe(1);
    expect(res.transactionCount).toBe(2);
    expect(res.totalRevenueMinorUnits).toBe(2000);
    expect(res.cardTotalMinorUnits).toBe(1200);
    expect(res.cashTotalMinorUnits).toBe(800);
    expect(res.averageBasketMinorUnits).toBe(1000); // 2000 / 2
    expect(res.days).toHaveLength(1);
    expect(res.days[0].totalRevenueMinorUnits).toBe(2000);
  });

  it('period average basket = total revenue / total tx (never an avg of daily averages)', () => {
    // Day 1: 1 sale of 1000 (avg 1000). Day 2: 3 sales of 100 each (avg ~33).
    // Avg-of-averages would be ~516; correct period basket = 1300/4 = 325.
    const res = aggregatePeriod({
      completed: [
        sale('2026-07-01T09:00:00Z', 1000, 0, 0, [['card', 1000]]),
        sale('2026-07-02T09:00:00Z', 100, 0, 0, [['cash', 100]]),
        sale('2026-07-02T10:00:00Z', 100, 0, 0, [['cash', 100]]),
        sale('2026-07-02T11:00:00Z', 100, 0, 0, [['cash', 100]]),
      ],
      voided: [],
      startDate: '2026-07-01',
      endDate: '2026-07-02',
    });
    expect(res.transactionCount).toBe(4);
    expect(res.totalRevenueMinorUnits).toBe(1300);
    expect(res.averageBasketMinorUnits).toBe(325);
    expect(res.days[0].averageBasketMinorUnits).toBe(1000); // 1000 / 1
    expect(res.days[1].averageBasketMinorUnits).toBe(100); // 300 / 3
  });

  it('aggregates card + cash + other payment methods correctly', () => {
    const res = aggregatePeriod({
      completed: [
        sale('2026-07-01T09:00:00Z', 1000, 0, 0, [['card', 1000]]),
        sale('2026-07-01T10:00:00Z', 500, 0, 0, [['cash', 500]]),
        sale('2026-07-01T11:00:00Z', 700, 0, 0, [['voucher', 700]]),
        sale('2026-07-01T12:00:00Z', 900, 0, 0, [['card', 400], ['cash', 500]]), // split
      ],
      voided: [],
      startDate: '2026-07-01',
      endDate: '2026-07-01',
    });
    expect(res.cardTotalMinorUnits).toBe(1400);
    expect(res.cashTotalMinorUnits).toBe(1000);
    expect(res.otherPaymentsMinorUnits).toBe(700);
    const methods = Object.fromEntries(res.paymentBreakdown.map((p) => [p.method, p.amountMinorUnits]));
    expect(methods).toEqual({ card: 1400, cash: 1000, voucher: 700 });
  });

  it('includes days with no sales as explicit zero rows', () => {
    const res = aggregatePeriod({
      completed: [sale('2026-07-01T09:00:00Z', 1000, 0, 0, [['card', 1000]])],
      voided: [],
      startDate: '2026-07-01',
      endDate: '2026-07-03',
    });
    expect(res.days.map((d) => d.date)).toEqual(['2026-07-01', '2026-07-02', '2026-07-03']);
    expect(res.days[1]).toMatchObject({ transactionCount: 0, totalRevenueMinorUnits: 0, averageBasketMinorUnits: 0 });
  });

  it('excludes voided tickets from revenue but reports them separately', () => {
    const res = aggregatePeriod({
      completed: [sale('2026-07-01T09:00:00Z', 1000, 0, 0, [['card', 1000]])],
      voided: [
        { createdAt: '2026-07-01T09:30:00Z', totalMinorUnits: 500 },
        { createdAt: '2026-07-02T09:30:00Z', totalMinorUnits: 300 },
      ],
      startDate: '2026-07-01',
      endDate: '2026-07-02',
    });
    expect(res.totalRevenueMinorUnits).toBe(1000); // voided not counted
    expect(res.voidCount).toBe(2);
    expect(res.voidedAmountMinorUnits).toBe(800);
    expect(res.days[0].voidCount).toBe(1);
    expect(res.days[1].voidCount).toBe(1);
  });

  it('aggregates discounts across the period', () => {
    const res = aggregatePeriod({
      completed: [
        sale('2026-07-01T09:00:00Z', 900, 0, 100, [['card', 900]]),
        sale('2026-07-02T09:00:00Z', 800, 0, 200, [['cash', 800]]),
      ],
      voided: [],
      startDate: '2026-07-01',
      endDate: '2026-07-02',
    });
    expect(res.discountTotalMinorUnits).toBe(300);
  });

  it('buckets sales by Paris-local day across the UTC midnight boundary', () => {
    // 2026-07-01 23:30 UTC → 2026-07-02 Paris. Belongs to day 2, not day 1.
    const res = aggregatePeriod({
      completed: [sale('2026-07-01T23:30:00Z', 1000, 0, 0, [['card', 1000]])],
      voided: [],
      startDate: '2026-07-01',
      endDate: '2026-07-02',
    });
    expect(res.days[0].transactionCount).toBe(0); // 2026-07-01
    expect(res.days[1].transactionCount).toBe(1); // 2026-07-02
  });
});
