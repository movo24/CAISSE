import { convertMinor } from './convert-amount';

describe('POS currency convertMinor', () => {
  it('EUR→USD same precision (2,2)', () => {
    // 10.00 EUR × 1.10 = 11.00 USD → 1100
    expect(convertMinor(1000, 1.1, 2, 2)).toBe(1100);
  });
  it('rounds to nearest minor unit', () => {
    // 9.99 × 1.085 = 10.83915 → 1084
    expect(convertMinor(999, 1.085, 2, 2)).toBe(1084);
  });
  it('rate 1 is identity (same precision)', () => {
    expect(convertMinor(1234, 1, 2, 2)).toBe(1234);
  });
  it('handles differing precision (2 → 0, e.g. JPY)', () => {
    // 10.00 × 150 = 1500 yen (precision 0) → 1500
    expect(convertMinor(1000, 150, 2, 0)).toBe(1500);
  });
});
