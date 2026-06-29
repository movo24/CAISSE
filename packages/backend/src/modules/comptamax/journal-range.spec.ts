import { dayRangeUtc, inclusiveRangeUtc } from './journal-range';

describe('Comptamax journal-range', () => {
  describe('dayRangeUtc', () => {
    it('half-open day interval', () => {
      const { start, end } = dayRangeUtc('2026-06-29');
      expect(start.toISOString()).toBe('2026-06-29T00:00:00.000Z');
      expect(end.toISOString()).toBe('2026-06-30T00:00:00.000Z');
    });
    it('rejects bad format', () => {
      expect(() => dayRangeUtc('29/06/2026')).toThrow();
      expect(() => dayRangeUtc('')).toThrow();
    });
  });

  describe('inclusiveRangeUtc', () => {
    it('includes both endpoints (end = day after `to`)', () => {
      const { start, end } = inclusiveRangeUtc('2026-06-01', '2026-06-30');
      expect(start.toISOString()).toBe('2026-06-01T00:00:00.000Z');
      expect(end.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    });
    it('single-day range equals dayRange', () => {
      expect(inclusiveRangeUtc('2026-06-29', '2026-06-29')).toEqual(dayRangeUtc('2026-06-29'));
    });
    it('rejects end before start', () => {
      expect(() => inclusiveRangeUtc('2026-06-30', '2026-06-01')).toThrow();
    });
  });
});
