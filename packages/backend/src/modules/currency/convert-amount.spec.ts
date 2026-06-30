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

  describe('float-precision .5 boundary (POS-INT-137)', () => {
    it('rounds 107135 × 1.1 = 117848.5 UP to 117849 (was 117848)', () => {
      expect(convertMinor(107135, 1.1, 2, 2)).toBe(117849);
    });
    it('rounds 579100 × 0.835 = 483548.5 UP to 483549 (was 483548)', () => {
      expect(convertMinor(579100, 0.835, 2, 2)).toBe(483549);
    });
    it('0 → 0', () => {
      expect(convertMinor(0, 1.1, 2, 2)).toBe(0);
    });
    it('precision 0 → 2 (e.g. JPY→EUR)', () => {
      // 1500 yen × 0.0061 = 9.15 → 9.15 EUR minor → round(1500*0.0061*100)=915
      expect(convertMinor(1500, 0.0061, 0, 2)).toBe(915);
    });
  });
});
