/**
 * POS-070/073 — Coupon redemption policy (pure, unit-testable).
 * Extracted from CouponService.redeem (behavior-preserving): same predicates the
 * service used inline for idempotency-key validity, availability, expiry and cooldown.
 */

/** Idempotency key must exist and be at least 10 chars (matches the inline guard). */
export function isValidIdempotencyKey(key: string | null | undefined): boolean {
  return !!key && key.length >= 10;
}

export function isCouponAvailable(status: string | null | undefined): boolean {
  return status === 'AVAILABLE';
}

/** Expired when validUntil is set and strictly in the past. Null validUntil = never expires. */
export function isCouponExpired(
  validUntil: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!validUntil) return false;
  return new Date(validUntil).getTime() < now.getTime();
}

/** End of the cooldown window for a coupon used at `usedAt`. */
export function cooldownEnd(usedAt: Date | string, cooldownDays: number): Date {
  const d = new Date(usedAt);
  d.setDate(d.getDate() + cooldownDays);
  return d;
}

/** True when the customer is still within the post-redemption cooldown window. */
export function isInCooldown(
  usedAt: Date | string | null | undefined,
  cooldownDays: number,
  now: Date = new Date(),
): boolean {
  if (!usedAt) return false;
  return cooldownEnd(usedAt, cooldownDays) > now;
}

/** Whole days remaining before the cooldown ends (0 when not in cooldown). Ceil, like the UI. */
export function daysRemainingInCooldown(
  usedAt: Date | string | null | undefined,
  cooldownDays: number,
  now: Date = new Date(),
): number {
  if (!usedAt) return 0;
  const end = cooldownEnd(usedAt, cooldownDays);
  if (end <= now) return 0;
  return Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}
