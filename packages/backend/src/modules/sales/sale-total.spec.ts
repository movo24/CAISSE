import { sumLineNets, assertSaleTotalsConsistent, SaleTotalInconsistency } from './sale-total';

describe('sale-total consistency guard (POS-INT-131)', () => {
  it('sumLineNets adds the line nets', () => {
    expect(sumLineNets([100, 200, 50])).toBe(350);
    expect(sumLineNets([])).toBe(0);
  });

  it('passes when Σ line nets equals the total', () => {
    expect(assertSaleTotalsConsistent([600, 400], 1000)).toBe(1000);
    expect(assertSaleTotalsConsistent([1500], 1500)).toBe(1500);
  });

  it('throws SaleTotalInconsistency on any drift', () => {
    expect(() => assertSaleTotalsConsistent([600, 400], 999)).toThrow(SaleTotalInconsistency);
    expect(() => assertSaleTotalsConsistent([333, 333, 333], 1000)).toThrow(/≠ total/);
  });

  it('exposes the two amounts on the error for diagnostics', () => {
    try {
      assertSaleTotalsConsistent([500], 600);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(SaleTotalInconsistency);
      expect((e as SaleTotalInconsistency).sumLineNets).toBe(500);
      expect((e as SaleTotalInconsistency).totalAfterDiscount).toBe(600);
    }
  });
});
