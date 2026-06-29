/**
 * POS — Notifications policy (pure, unit-testable).
 * Extracted from NotificationsService (behavior-preserving): days-since-visit,
 * inactivity gate, reactivation base priority + sort rank, and stock severity.
 *
 * NB: the 60/90-day reactivation cutoffs are operational defaults (tunable);
 * `inactiveDays` is already a caller parameter.
 */

export type ReminderPriority = 'high' | 'medium' | 'low';
export type StockLevel = 'out_of_stock' | 'critical' | 'alert';

/** Whole days between `lastVisit` and `now`; null when never visited. */
export function daysSince(
  lastVisit: Date | null,
  nowMs: number = Date.now(),
): number | null {
  if (!lastVisit) return null;
  return Math.floor((nowMs - lastVisit.getTime()) / (1000 * 60 * 60 * 24));
}

/** Customer is a reactivation candidate: never visited or inactive ≥ inactiveDays. */
export function isInactiveCustomer(
  daysSinceLastVisit: number | null,
  lastVisitIsNull: boolean,
  inactiveDays: number,
): boolean {
  return lastVisitIsNull || (daysSinceLastVisit ?? 0) >= inactiveDays;
}

/** Base priority before the loyalty-points bump (never→medium, ≥90→high, ≥60→medium, else low). */
export function baseReactivationPriority(
  daysSinceLastVisit: number | null,
  lastVisitIsNull: boolean,
): ReminderPriority {
  if (lastVisitIsNull) return 'medium';
  const d = daysSinceLastVisit ?? 0;
  if (d >= 90) return 'high';
  if (d >= 60) return 'medium';
  return 'low';
}

/** Sort rank (high=0 < medium=1 < low=2). */
export function priorityRank(p: ReminderPriority): number {
  return { high: 0, medium: 1, low: 2 }[p];
}

/** Stock severity from quantity vs thresholds; null when stock is healthy. */
export function stockNotificationLevel(
  quantity: number,
  criticalThreshold: number,
  alertThreshold: number,
): StockLevel | null {
  if (quantity <= 0) return 'out_of_stock';
  if (quantity <= criticalThreshold) return 'critical';
  if (quantity <= alertThreshold) return 'alert';
  return null;
}
