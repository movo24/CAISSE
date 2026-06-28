import { isValidPinFormat, isWeakPin } from './pin-policy';

describe('POS pin-policy', () => {
  describe('isValidPinFormat', () => {
    it('accepts 4–8 digits', () => {
      expect(isValidPinFormat('1234')).toBe(true);
      expect(isValidPinFormat('12345678')).toBe(true);
      expect(isValidPinFormat('0000')).toBe(true);
    });
    it('rejects too short / too long / non-digit / nullish', () => {
      expect(isValidPinFormat('123')).toBe(false);
      expect(isValidPinFormat('123456789')).toBe(false);
      expect(isValidPinFormat('12a4')).toBe(false);
      expect(isValidPinFormat('')).toBe(false);
      expect(isValidPinFormat(null)).toBe(false);
      expect(isValidPinFormat(1234 as unknown)).toBe(false);
    });
  });

  describe('isWeakPin (advisory, not enforced)', () => {
    it('flags all-same-digit', () => {
      expect(isWeakPin('0000')).toBe(true);
      expect(isWeakPin('1111')).toBe(true);
    });
    it('flags ascending / descending runs', () => {
      expect(isWeakPin('1234')).toBe(true);
      expect(isWeakPin('4321')).toBe(true);
      expect(isWeakPin('3456')).toBe(true);
    });
    it('passes non-trivial PINs', () => {
      expect(isWeakPin('1357')).toBe(false);
      expect(isWeakPin('8042')).toBe(false);
    });
    it('returns false for malformed input (defers to format check)', () => {
      expect(isWeakPin('12')).toBe(false);
    });
  });
});
