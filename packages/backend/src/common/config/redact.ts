/**
 * POS-INT-232 — secret redaction for safe logging (pure, unit-testable).
 * Logs must reference secret VARIABLE NAMES only, never their values. Use these
 * helpers anywhere an env/config value could otherwise reach a log line.
 */

/** Fully mask a value (never reveal any character). Empty stays empty. */
export function maskSecret(value: string | undefined | null): string {
  if (value === undefined || value === null || value === '') return '';
  return '***';
}

/** Return { KEY: '***' } for the given keys — safe to log (names + masked values). */
export function redactForLog(
  env: Record<string, string | undefined>,
  keys: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = env[k] === undefined ? '(unset)' : maskSecret(env[k]);
  return out;
}
