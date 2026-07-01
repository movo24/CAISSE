/**
 * POS-INT-212 — boot-time env validation (pure, unit-testable).
 * Extracted from main.ts (behavior-preserving) so the fail-fast rules that gate
 * startup can be tested without booting the app. Throws on any fatal misconfig;
 * non-fatal recommendations stay as logger.warn in main.ts.
 */
export type EnvLike = Record<string, string | undefined>;

export function validateRequiredEnv(env: EnvLike): void {
  // Critical secrets — app MUST NOT start without these.
  const required = ['DATABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET'];
  const missing = required.filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(
      `FATAL: Missing required environment variables: ${missing.join(', ')}. ` +
        'Copy .env.example to .env and fill in all values.',
    );
  }

  // Reject insecure defaults.
  if (env.JWT_SECRET === 'dev-jwt-secret' || env.JWT_REFRESH_SECRET === 'dev-refresh-secret') {
    throw new Error('JWT secrets must not use insecure defaults. Generate with: openssl rand -hex 32');
  }

  // Minimum secret length.
  if ((env.JWT_SECRET as string).length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }

  // Production-only fail-fast checks.
  if (env.NODE_ENV === 'production') {
    if (env.TYPEORM_SYNCHRONIZE === 'true') {
      throw new Error('FATAL: TYPEORM_SYNCHRONIZE=true is forbidden in production');
    }
    if (!env.REDIS_URL && env.ALLOW_INMEMORY_CACHE !== 'true') {
      throw new Error(
        'REDIS_URL must be set in production (shared cache for token revocation / OTP / rate-limit). ' +
          'For a single-pod deployment only, set ALLOW_INMEMORY_CACHE=true to opt out.',
      );
    }
    if (!env.CORS_ORIGIN) {
      throw new Error(
        'CORS_ORIGIN must be set to an explicit, comma-separated origin list in production (credentials are enabled)',
      );
    }
    if (env.CORS_ORIGIN.trim() === '*') {
      throw new Error('CORS_ORIGIN cannot be "*" in production — a wildcard with credentials is unsafe');
    }
  }
}
