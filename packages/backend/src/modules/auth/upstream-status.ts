/**
 * POS — Upstream (TimeWin24) reachability classification (pure, unit-testable).
 * Extracted from AuthService (behavior-preserving): distinguishes an unreachable
 * / server-error upstream (no status, or 5xx) from a genuine client auth error
 * (4xx). Drives the "online required" vs "invalid credentials" branch.
 */

/** True when the error denotes an unreachable or failing upstream (status absent or 5xx). */
export function isUpstreamUnavailable(status: number | undefined | null): boolean {
  return status === undefined || status === null || status >= 500;
}
