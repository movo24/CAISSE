/**
 * Side-effect import: ensure JWT secrets exist BEFORE any module that validates
 * them at import time (AuthModule/RealtimeModule evaluate process.env.JWT_SECRET
 * in their @Module metadata). Import this FIRST in suites that boot those modules.
 * Idempotent + only sets when unset, so it never overrides a real/global value.
 */
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long-xx';
}
if (!process.env.JWT_REFRESH_SECRET) {
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-chars-yy';
}
