/**
 * POS — TimeWin24 health classification (pure, unit-testable).
 * Extracted from TimewinService.isHealthy (behavior-preserving): the upstream is
 * considered healthy when it reports 'ok' or 'degraded' (degraded still serves).
 */

/** True when a TW24 /health status string is acceptable ('ok' or 'degraded'). */
export function isHealthyTimeWinStatus(status: string | null | undefined): boolean {
  return status === 'ok' || status === 'degraded';
}
