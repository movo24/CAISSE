import { averageBasket } from './average-basket';

describe('POS reports average-basket', () => {
  it('rounds revenue per transaction', () => {
    expect(averageBasket(1000, 4)).toBe(250);
    expect(averageBasket(1000, 3)).toBe(333); // 333.33 → 333
  });
  it('0 when no transactions (no division by zero)', () => {
    expect(averageBasket(1000, 0)).toBe(0);
    expect(averageBasket(0, 0)).toBe(0);
  });
});
