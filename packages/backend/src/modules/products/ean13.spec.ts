import {
  ean13CheckDigit,
  isValidEan13,
  buildEan13,
  isInternalEan,
  INTERNAL_EAN_PREFIX,
} from './ean13';

describe('POS ean13', () => {
  describe('ean13CheckDigit', () => {
    it('computes known GS1 check digits', () => {
      // 978020137962 → 4 (classic ISBN-13 example)
      expect(ean13CheckDigit('978020137962')).toBe(4);
      // 400638133393 → 1
      expect(ean13CheckDigit('400638133393')).toBe(1);
    });
    it('returns 0 when sum is a multiple of 10', () => {
      expect(ean13CheckDigit('000000000000')).toBe(0);
    });
    it('rejects non-12-digit input', () => {
      expect(() => ean13CheckDigit('123')).toThrow();
      expect(() => ean13CheckDigit('29012345678X')).toThrow();
    });
  });

  describe('buildEan13', () => {
    it('appends the correct check digit (round-trips through isValidEan13)', () => {
      const full = buildEan13('290123456789');
      expect(full).toHaveLength(13);
      expect(isValidEan13(full)).toBe(true);
    });
  });

  describe('isValidEan13', () => {
    it('accepts a valid full code', () => {
      expect(isValidEan13('9780201379624')).toBe(true);
    });
    it('rejects wrong check digit', () => {
      expect(isValidEan13('9780201379625')).toBe(false);
    });
    it('rejects wrong length / non-digit / nullish', () => {
      expect(isValidEan13('978020137962')).toBe(false); // 12
      expect(isValidEan13('97802013796244')).toBe(false); // 14
      expect(isValidEan13('978020137962X')).toBe(false);
      expect(isValidEan13(null)).toBe(false);
      expect(isValidEan13(undefined)).toBe(false);
    });
  });

  describe('isInternalEan', () => {
    it('detects the 290 prefix', () => {
      expect(isInternalEan('2901234567894')).toBe(true);
      expect(isInternalEan('3760123456789')).toBe(false);
      expect(isInternalEan(null)).toBe(false);
    });
    it('exposes the prefix constant', () => {
      expect(INTERNAL_EAN_PREFIX).toBe('290');
    });
  });
});
