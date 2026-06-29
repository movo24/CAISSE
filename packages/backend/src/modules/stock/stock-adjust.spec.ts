import { applyStockAdjustment } from './stock-level';

describe('POS stock applyStockAdjustment', () => {
  it('delta adds to current', () => {
    expect(applyStockAdjustment(10, 5, 'delta')).toBe(15);
    expect(applyStockAdjustment(10, -3, 'delta')).toBe(7);
  });
  it('delta clamps to 0 (no negative stock)', () => {
    expect(applyStockAdjustment(2, -5, 'delta')).toBe(0);
  });
  it('absolute sets the value', () => {
    expect(applyStockAdjustment(10, 4, 'absolute')).toBe(4);
  });
  it('absolute clamps to 0', () => {
    expect(applyStockAdjustment(10, -2, 'absolute')).toBe(0);
  });
});
