import {
  formatOtpCode,
  otpExpiresAt,
  isOtpExpired,
  isOtpMaxAttempts,
  otpCodeMatches,
  OTP_TTL_MS,
  OTP_MAX_ATTEMPTS,
} from './otp-policy';

describe('POS customers otp-policy', () => {
  describe('formatOtpCode', () => {
    it('always yields a 6-digit string in range', () => {
      expect(formatOtpCode(0)).toBe('100000');
      expect(formatOtpCode(899999)).toBe('999999');
      expect(formatOtpCode(900000)).toBe('100000'); // wraps via modulo
      const c = formatOtpCode(123456789);
      expect(c).toHaveLength(6);
      expect(Number(c)).toBeGreaterThanOrEqual(100000);
      expect(Number(c)).toBeLessThanOrEqual(999999);
    });
  });

  describe('otpExpiresAt / isOtpExpired', () => {
    it('adds the 10-min TTL', () => {
      expect(OTP_TTL_MS).toBe(600000);
      expect(otpExpiresAt(1_000)).toBe(601_000);
    });
    it('expired strictly before now', () => {
      expect(isOtpExpired(1000, 1001)).toBe(true);
      expect(isOtpExpired(1000, 1000)).toBe(false);
      expect(isOtpExpired(1000, 999)).toBe(false);
    });
  });

  describe('isOtpMaxAttempts', () => {
    it('caps at 5', () => {
      expect(OTP_MAX_ATTEMPTS).toBe(5);
      expect(isOtpMaxAttempts(4)).toBe(false);
      expect(isOtpMaxAttempts(5)).toBe(true);
      expect(isOtpMaxAttempts(6)).toBe(true);
    });
  });

  describe('otpCodeMatches', () => {
    it('strict equality', () => {
      expect(otpCodeMatches('123456', '123456')).toBe(true);
      expect(otpCodeMatches('123456', '123457')).toBe(false);
    });
  });
});
