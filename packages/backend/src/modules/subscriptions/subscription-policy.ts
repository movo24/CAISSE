/**
 * POS — Subscription policy (pure, unit-testable).
 * Extracted from SubscriptionsService (behavior-preserving): quota limits (-1 = unlimited)
 * and access denial (suspended / cancelled-past-period).
 */
export function isUnlimited(max: number): boolean {
  return max === -1;
}

/** True when `count` is within `max` (unlimited when max === -1). */
export function isWithinLimit(count: number, max: number): boolean {
  return isUnlimited(max) || count < max;
}

export type SubscriptionDenial = 'suspended' | 'expired';

/**
 * Reason a subscription denies access, or null if allowed.
 * - suspended → always denied
 * - cancelled → denied only once the current period has ended (grace period before)
 */
export function subscriptionAccessDenial(
  status: string,
  currentPeriodEnd: Date | string | null | undefined,
  now: Date = new Date(),
): SubscriptionDenial | null {
  if (status === 'suspended') return 'suspended';
  if (status === 'cancelled') {
    if (currentPeriodEnd && new Date(currentPeriodEnd).getTime() < now.getTime()) {
      return 'expired';
    }
  }
  return null;
}
