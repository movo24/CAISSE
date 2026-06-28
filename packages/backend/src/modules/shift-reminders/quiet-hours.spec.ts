import { isQuietHour, isHoliday } from './quiet-hours';

describe('POS-055 quiet-hours', () => {
  describe('isQuietHour', () => {
    it('same-day window [9,17)', () => {
      expect(isQuietHour(8, 9, 17)).toBe(false);
      expect(isQuietHour(9, 9, 17)).toBe(true);
      expect(isQuietHour(16, 9, 17)).toBe(true);
      expect(isQuietHour(17, 9, 17)).toBe(false);
    });
    it('window wrapping midnight [21,8)', () => {
      expect(isQuietHour(22, 21, 8)).toBe(true);
      expect(isQuietHour(3, 21, 8)).toBe(true);
      expect(isQuietHour(8, 21, 8)).toBe(false);
      expect(isQuietHour(12, 21, 8)).toBe(false);
    });
    it('empty window (start===end) = never quiet', () => {
      expect(isQuietHour(10, 10, 10)).toBe(false);
    });
  });

  describe('isHoliday', () => {
    const holidays = new Set(['2026-12-25', '2026-01-01']);
    it('detects a holiday date', () => {
      expect(isHoliday(new Date('2026-12-25T10:00:00Z'), holidays)).toBe(true);
    });
    it('non-holiday is false', () => {
      expect(isHoliday(new Date('2026-06-28T10:00:00Z'), holidays)).toBe(false);
    });
  });
});
