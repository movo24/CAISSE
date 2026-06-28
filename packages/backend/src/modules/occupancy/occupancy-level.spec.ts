import { occupancyLevel, isOccupancyStale } from './occupancy-level';

describe('POS occupancy-level', () => {
  describe('occupancyLevel', () => {
    it('0 = empty', () => {
      expect(occupancyLevel(0, 100)).toBe('empty');
    });
    it('unknown when no capacity', () => {
      expect(occupancyLevel(5, 0)).toBe('unknown');
      expect(occupancyLevel(5, null)).toBe('unknown');
    });
    it('classifies by ratio (defaults 0.4/0.7/1)', () => {
      expect(occupancyLevel(30, 100)).toBe('low'); // 0.30
      expect(occupancyLevel(50, 100)).toBe('medium'); // 0.50
      expect(occupancyLevel(80, 100)).toBe('high'); // 0.80
      expect(occupancyLevel(100, 100)).toBe('full'); // 1.0
      expect(occupancyLevel(120, 100)).toBe('full'); // over capacity
    });
  });

  describe('isOccupancyStale', () => {
    const now = new Date('2026-06-28T12:00:00Z');
    it('fresh feed = not stale', () => {
      expect(isOccupancyStale('2026-06-28T11:58:00Z', 5 * 60 * 1000, now)).toBe(false);
    });
    it('old feed = stale', () => {
      expect(isOccupancyStale('2026-06-28T11:50:00Z', 5 * 60 * 1000, now)).toBe(true);
    });
  });
});
