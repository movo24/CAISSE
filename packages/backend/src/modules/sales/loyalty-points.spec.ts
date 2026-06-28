import { loyaltyPointsEarned } from './loyalty-points';

describe('POS loyaltyPointsEarned', () => {
  it('1 point per euro (floor)', () => {
    expect(loyaltyPointsEarned(1000)).toBe(10);
    expect(loyaltyPointsEarned(1599)).toBe(15);
  });
  it('below 1€ = 0', () => {
    expect(loyaltyPointsEarned(99)).toBe(0);
  });
  it('zero/negative = 0', () => {
    expect(loyaltyPointsEarned(0)).toBe(0);
    expect(loyaltyPointsEarned(-500)).toBe(0);
  });
});
