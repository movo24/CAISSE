import {
  normalizeCreditCode,
  formatCreditCode,
  isGeneratedCreditCode,
  AVOIR_PREFIX,
  GIFT_PREFIX,
} from './credit-code';

describe('POS credit-code', () => {
  describe('normalizeCreditCode', () => {
    it('trims and uppercases', () => {
      expect(normalizeCreditCode('  av-12ab34cd56 ')).toBe('AV-12AB34CD56');
    });
    it('nullish → empty string', () => {
      expect(normalizeCreditCode(null)).toBe('');
      expect(normalizeCreditCode(undefined)).toBe('');
      expect(normalizeCreditCode('   ')).toBe('');
    });
  });

  describe('formatCreditCode', () => {
    it('prefixes and keeps 10 uppercase hex chars', () => {
      // randomBytes(5).toString('hex') = 10 hex chars
      expect(formatCreditCode(AVOIR_PREFIX, 'abcdef0123')).toBe('AV-ABCDEF0123');
      expect(formatCreditCode(GIFT_PREFIX, 'abcdef0123')).toBe('GC-ABCDEF0123');
    });
    it('truncates anything longer than 10', () => {
      expect(formatCreditCode(AVOIR_PREFIX, '0123456789ff')).toBe('AV-0123456789');
    });
  });

  describe('isGeneratedCreditCode', () => {
    it('accepts well-formed generated codes', () => {
      expect(isGeneratedCreditCode('AV-0123456789')).toBe(true);
      expect(isGeneratedCreditCode('GC-ABCDEF0123')).toBe(true);
    });
    it('rejects custom / malformed codes', () => {
      expect(isGeneratedCreditCode('GIFT2026')).toBe(false);
      expect(isGeneratedCreditCode('AV-XYZ')).toBe(false);
      expect(isGeneratedCreditCode('AV-0123456789'.toLowerCase())).toBe(false);
      expect(isGeneratedCreditCode(null)).toBe(false);
    });
  });
});
