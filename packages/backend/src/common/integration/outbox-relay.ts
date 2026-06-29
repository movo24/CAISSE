/**
 * POS — Outbox relay policy (pure, unit-testable).
 *
 * Decides which outbox rows are eligible for (re)publication and the resulting
 * delivery status after an attempt. Pure: no DB, no network. The actual sink
 * (Comptamax24 / TimeWin24 / Analytik R) is injected by the service; in sandbox
 * a simulation sink is used (no secret, no real send).
 *
 * Only delivery metadata (status/attempts/publishedAt) changes — business fields
 * of the event stay immutable (append-only).
 */
import type { OutboxStatus } from './integration-event';

export const MAX_RELAY_ATTEMPTS = 5;

/**
 * Whether the automatic relay cron is enabled. Default OFF: while the publisher
 * is the simulation sink (or until a real publisher + secrets are configured),
 * the cron stays disabled so nothing fires unattended. Set OUTBOX_RELAY_ENABLED=true
 * to activate (prod, with a real publisher).
 */
export function isRelayCronEnabled(flag: string | undefined | null): boolean {
  return flag === 'true' || flag === '1';
}

/** Exponential backoff in ms for a given attempt count (capped at 1h). */
export function relayBackoffMs(attempts: number, baseMs = 1000): number {
  const ms = baseMs * 2 ** Math.max(0, attempts);
  return Math.min(ms, 60 * 60 * 1000);
}

/** A row is eligible when pending, or failed-but-retryable under the attempt cap. */
export function isEligibleForRelay(
  status: string,
  attempts: number,
  maxAttempts = MAX_RELAY_ATTEMPTS,
): boolean {
  if (status === 'published') return false;
  if (status === 'pending') return true;
  if (status === 'failed') return attempts < maxAttempts;
  return false;
}

export interface RelayOutcome {
  status: OutboxStatus;
  attempts: number;
  publishedAt: Date | null;
}

/**
 * New delivery state after one publish attempt.
 *  - success            → published (publishedAt set)
 *  - failure, retries   → pending (will be retried)
 *  - failure, cap hit   → failed (dead-letter; manual intervention)
 */
export function relayOutcome(
  success: boolean,
  attempts: number,
  now: Date = new Date(),
  maxAttempts = MAX_RELAY_ATTEMPTS,
): RelayOutcome {
  const nextAttempts = attempts + 1;
  if (success) return { status: 'published', attempts: nextAttempts, publishedAt: now };
  if (nextAttempts >= maxAttempts) return { status: 'failed', attempts: nextAttempts, publishedAt: null };
  return { status: 'pending', attempts: nextAttempts, publishedAt: null };
}
