/**
 * POS — Loyalty QR token helpers (pure, unit-testable).
 * Extracted from LoyaltyTokenService / LoyaltyCardService (behavior-preserving):
 * TTL computation, expiry check, constant-time signature compare, required-claims
 * check, and card-active gate.
 */

/** QR token time-to-live, in seconds (mobile app rotates automatically). */
export const QR_TTL_SECONDS = 60;

/** Absolute expiry (unix ms) for a token minted at `nowMs`. */
export function tokenExpiresAt(
  nowMs: number,
  ttlSeconds: number = QR_TTL_SECONDS,
): number {
  return nowMs + ttlSeconds * 1000;
}

/** True when the token is expired (now strictly past expiry — matches legacy `>`). */
export function isTokenExpired(
  expiresAtMs: number,
  nowMs: number = Date.now(),
): boolean {
  return nowMs > expiresAtMs;
}

/** Constant-time string compare (guards against timing attacks on the signature). */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let res = 0;
  for (let i = 0; i < a.length; i++) {
    res |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return res === 0;
}

/** A decoded payload must carry both IDs to be usable. */
export function hasRequiredClaims(payload: {
  customerId?: unknown;
  cardId?: unknown;
}): boolean {
  return Boolean(payload?.customerId) && Boolean(payload?.cardId);
}

/** True when a loyalty card status allows QR issuance / use. */
export function isCardActive(status: string | null | undefined): boolean {
  return status === 'ACTIVE';
}
