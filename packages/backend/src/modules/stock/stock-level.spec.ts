import {
  classifyStockLevel,
  crossedDownward,
  relativeThreshold,
  effectiveAlertThreshold,
} from './stock-level';

describe('POS-080/083 stock-level helpers', () => {
  describe('classifyStockLevel (absolute thresholds)', () => {
    it('0 or less = out_of_stock', () => {
      expect(classifyStockLevel(0, 10, 5)).toBe('out_of_stock');
      expect(classifyStockLevel(-3, 10, 5)).toBe('out_of_stock');
    });
    it('<= critical = critical', () => {
      expect(classifyStockLevel(5, 10, 5)).toBe('critical');
      expect(classifyStockLevel(3, 10, 5)).toBe('critical');
    });
    it('<= alert and > critical = alert', () => {
      expect(classifyStockLevel(10, 10, 5)).toBe('alert');
      expect(classifyStockLevel(7, 10, 5)).toBe('alert');
    });
    it('> alert = ok', () => {
      expect(classifyStockLevel(11, 10, 5)).toBe('ok');
      expect(classifyStockLevel(100, 10, 5)).toBe('ok');
    });
  });

  describe('crossedDownward (alert fires once at crossing)', () => {
    it('true only when moving from above to at/below threshold', () => {
      expect(crossedDownward(11, 10, 10)).toBe(true); // 11 -> 10 crosses 10
      expect(crossedDownward(10, 9, 10)).toBe(false); // already at/below before
      expect(crossedDownward(20, 12, 10)).toBe(false); // stayed above
      expect(crossedDownward(6, 4, 5)).toBe(true); // 6 -> 4 crosses 5
    });
  });

  describe('relativeThreshold (POS-083 — baseline undecided)', () => {
    it('ceils the percentage of a baseline', () => {
      expect(relativeThreshold(100, 20)).toBe(20);
      expect(relativeThreshold(11, 20)).toBe(3); // ceil(2.2)
      expect(relativeThreshold(0, 20)).toBe(0);
    });
    it('defaults to 20%', () => {
      expect(relativeThreshold(50)).toBe(10);
    });
  });

  describe('effectiveAlertThreshold (POS-083 baseline wins, else absolute)', () => {
    it('uses 20% of baseline when baseline is set', () => {
      expect(effectiveAlertThreshold(100, 10)).toBe(20);
      expect(effectiveAlertThreshold(50, 10)).toBe(10);
    });
    it('falls back to absolute threshold when baseline null/0', () => {
      expect(effectiveAlertThreshold(null, 10)).toBe(10);
      expect(effectiveAlertThreshold(0, 7)).toBe(7);
      expect(effectiveAlertThreshold(undefined, 4)).toBe(4);
    });
  });
});
