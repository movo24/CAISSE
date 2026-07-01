/**
 * POS-INT-216 — resume preflight: pure classification logic (unit-testable).
 * The CLI (scripts/preflight.sh) gathers raw findings; this module decides the
 * per-check status and the overall verdict. No I/O, no secret.
 */
export type CheckStatus = 'pass' | 'warn' | 'fail';
export interface PreflightCheck {
  name: string;
  status: CheckStatus;
  detail?: string;
}

/** Overall = FAIL if any fail, else WARN if any warn, else PASS. */
export function overallVerdict(checks: readonly PreflightCheck[]): CheckStatus {
  if (checks.some((c) => c.status === 'fail')) return 'fail';
  if (checks.some((c) => c.status === 'warn')) return 'warn';
  return 'pass';
}

/** Env vars read in code but absent from .env.example → these are FAIL-worthy. */
export function missingEnvVars(usedVars: readonly string[], documentedVars: readonly string[]): string[] {
  const doc = new Set(documentedVars);
  return [...new Set(usedVars)].filter((v) => !doc.has(v)).sort();
}

/** Required keys that MUST be documented in .env.example. */
export function missingRequiredKeys(documentedVars: readonly string[], requiredKeys: readonly string[]): string[] {
  const doc = new Set(documentedVars);
  return requiredKeys.filter((k) => !doc.has(k));
}

/** Map a boolean/gap into a status: empty gap = pass, else the given severity. */
export function statusFromGap(gap: readonly unknown[], severityWhenNonEmpty: CheckStatus): CheckStatus {
  return gap.length === 0 ? 'pass' : severityWhenNonEmpty;
}

/** Exit code convention: pass/warn = 0 (warn is non-blocking), fail = 1. */
export function exitCode(overall: CheckStatus): number {
  return overall === 'fail' ? 1 : 0;
}
