import { computePriceVerdict, PriceVerdictPeriod } from './price-verdict';

const base: PriceVerdictPeriod = {
  priceMinorUnits: 150,
  unitsPerDay: 22,
  marginPerDayMinorUnits: 1100, // 22 units * 50c margin
  daysDuration: 30,
  unitsSold: 660,
};

describe('computePriceVerdict', () => {
  it('returns FAVORABLE when a price rise improves margin/day', () => {
    // Price 1.50 → 1.80 (+20%), volume dips slightly, margin/day clearly up
    const prev = { ...base, priceMinorUnits: 150, unitsPerDay: 22, marginPerDayMinorUnits: 1100 };
    const cur = { ...base, priceMinorUnits: 180, unitsPerDay: 20, marginPerDayMinorUnits: 1600 };

    const v = computePriceVerdict(prev, cur);
    expect(v.verdict).toBe('favorable');
    expect(v.reliability).toBe('ok');
    expect(v.priceDeltaPct).toBeCloseTo(20);
    expect(v.marginPerDayDeltaPct).not.toBeNull();
    expect(v.marginPerDayDeltaPct! > 0).toBe(true);
  });

  it('returns UNFAVORABLE when a price rise collapses volume and margin/day', () => {
    // Price up but volume crashes → margin/day falls
    const prev = { ...base, priceMinorUnits: 150, unitsPerDay: 22, marginPerDayMinorUnits: 1100 };
    const cur = { ...base, priceMinorUnits: 180, unitsPerDay: 9, marginPerDayMinorUnits: 700 };

    const v = computePriceVerdict(prev, cur);
    expect(v.verdict).toBe('unfavorable');
    expect(v.marginPerDayDeltaPct! < 0).toBe(true);
  });

  it('returns NEUTRAL when margin/day barely moves', () => {
    const prev = { ...base, priceMinorUnits: 150, marginPerDayMinorUnits: 1100 };
    const cur = { ...base, priceMinorUnits: 180, marginPerDayMinorUnits: 1110 }; // +0.9%

    const v = computePriceVerdict(prev, cur);
    expect(v.verdict).toBe('neutral');
  });

  it('returns NO_PRICE_CHANGE when price barely moved', () => {
    const prev = { ...base, priceMinorUnits: 150, marginPerDayMinorUnits: 1100 };
    const cur = { ...base, priceMinorUnits: 150, marginPerDayMinorUnits: 1500 };

    const v = computePriceVerdict(prev, cur);
    expect(v.verdict).toBe('no_price_change');
  });

  it('returns INSUFFICIENT_DATA when cost (margin) is unknown', () => {
    const prev = { ...base, marginPerDayMinorUnits: null };
    const cur = { ...base, priceMinorUnits: 180, marginPerDayMinorUnits: null };

    const v = computePriceVerdict(prev, cur);
    expect(v.verdict).toBe('insufficient_data');
    expect(v.reliability).toBe('no_cost');
    expect(v.marginPerDayDeltaPct).toBeNull();
  });

  it('flags reliability LOW when the sample is too thin', () => {
    // Favorable direction but only 2 days / 4 units → tentative
    const prev = { priceMinorUnits: 150, unitsPerDay: 2, marginPerDayMinorUnits: 100, daysDuration: 2, unitsSold: 4 };
    const cur = { priceMinorUnits: 180, unitsPerDay: 2, marginPerDayMinorUnits: 160, daysDuration: 2, unitsSold: 4 };

    const v = computePriceVerdict(prev, cur);
    expect(v.verdict).toBe('favorable');
    expect(v.reliability).toBe('low');
    expect(v.label).toContain('à confirmer');
  });

  it('computes volume delta sign correctly', () => {
    const prev = { ...base, unitsPerDay: 20, priceMinorUnits: 150, marginPerDayMinorUnits: 1000 };
    const cur = { ...base, unitsPerDay: 15, priceMinorUnits: 180, marginPerDayMinorUnits: 1200 };

    const v = computePriceVerdict(prev, cur);
    expect(v.volumeDeltaPct).toBeCloseTo(-25);
  });
});
