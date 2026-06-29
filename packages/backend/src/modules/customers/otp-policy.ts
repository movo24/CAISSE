/**
 * POS — Customer OTP policy (pure, unit-testable).
 * Extracted from CustomersService (behavior-preserving): 6-digit code format,
 * TTL/expiry, attempt cap, and code comparison.
 */

export const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const OTP_MAX_ATTEMPTS = 5;

/** Format a 6-digit OTP from a 32-bit random integer (100000–999999). */
export function formatOtpCode(rand: number): string {
  return (100000 + (rand % 900000)).toString();
}

/** Absolute expiry (unix ms) for an OTP minted at `nowMs`. */
export function otpExpiresAt(nowMs: number, ttlMs: number = OTP_TTL_MS): number {
  return nowMs + ttlMs;
}

/** True when the OTP is expired (legacy `expiresAt < now`). */
export function isOtpExpired(expiresAtMs: number, nowMs: number = Date.now()): boolean {
  return expiresAtMs < nowMs;
}

/** True when the attempt count has reached the cap (legacy `attempts >= max`). */
export function isOtpMaxAttempts(
  attempts: number,
  max: number = OTP_MAX_ATTEMPTS,
): boolean {
  return attempts >= max;
}

/** Exact code comparison (legacy strict equality). */
export function otpCodeMatches(stored: string, provided: string): boolean {
  return stored === provided;
}
