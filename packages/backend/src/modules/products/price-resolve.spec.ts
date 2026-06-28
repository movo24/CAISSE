import { resolveEffectivePrice } from './price-resolve';

describe('POS-061 resolveEffectivePrice (store override wins)', () => {
  it('uses the override when set', () => {
    expect(resolveEffectivePrice(1000, 800)).toBe(800);
  });
  it('falls back to global when override is null/undefined', () => {
    expect(resolveEffectivePrice(1000, null)).toBe(1000);
    expect(resolveEffectivePrice(1000, undefined)).toBe(1000);
  });
  it('override of 0 is a valid (free) override and wins', () => {
    expect(resolveEffectivePrice(1000, 0)).toBe(0);
  });
  it('negative override is treated as unset → global', () => {
    expect(resolveEffectivePrice(1000, -5)).toBe(1000);
  });
});
