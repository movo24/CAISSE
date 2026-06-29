import { normalizePage, normalizeLimit, totalPages } from './pagination';

describe('POS common pagination', () => {
  describe('normalizePage', () => {
    it('defaults to 1 and floors at 1', () => {
      expect(normalizePage(undefined)).toBe(1);
      expect(normalizePage(0)).toBe(1);
      expect(normalizePage(-3)).toBe(1);
      expect(normalizePage(5)).toBe(5);
    });
  });

  describe('normalizeLimit', () => {
    it('defaults to 50', () => {
      expect(normalizeLimit(undefined)).toBe(50);
    });
    it('clamps to [1,100]', () => {
      expect(normalizeLimit(0)).toBe(1);
      expect(normalizeLimit(250)).toBe(100);
      expect(normalizeLimit(25)).toBe(25);
    });
    it('honours custom default/max', () => {
      expect(normalizeLimit(undefined, 20, 200)).toBe(20);
      expect(normalizeLimit(500, 20, 200)).toBe(200);
    });
  });

  describe('totalPages', () => {
    it('ceils total / limit', () => {
      expect(totalPages(100, 50)).toBe(2);
      expect(totalPages(101, 50)).toBe(3);
      expect(totalPages(0, 50)).toBe(0);
    });
    it('0 when limit <= 0 (no division by zero)', () => {
      expect(totalPages(10, 0)).toBe(0);
    });
  });
});
