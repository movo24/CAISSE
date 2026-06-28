import { normalizeName, isDuplicateName } from './name-normalize';

describe('POS-066 name-normalize', () => {
  describe('normalizeName', () => {
    it('lowercases and trims', () => {
      expect(normalizeName('  Coca Cola  ')).toBe('coca cola');
    });
    it('collapses internal whitespace', () => {
      expect(normalizeName('Coca   Cola')).toBe('coca cola');
    });
    it('strips diacritics (accents)', () => {
      expect(normalizeName('Café')).toBe('cafe');
      expect(normalizeName('Crème brûlée')).toBe('creme brulee');
    });
  });

  describe('isDuplicateName', () => {
    it('detects accent/case/space variants as duplicates', () => {
      expect(isDuplicateName('Café', ['CAFE'])).toBe(true);
      expect(isDuplicateName('coca  cola', ['Coca Cola'])).toBe(true);
    });
    it('distinct names are not duplicates', () => {
      expect(isDuplicateName('Thé', ['Café'])).toBe(false);
    });
    it('empty existing list = no duplicate', () => {
      expect(isDuplicateName('Café', [])).toBe(false);
    });
  });
});
