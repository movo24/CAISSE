/**
 * POS — Wesley Club (mobile-app) token builder, pure & unit-testable.
 *
 * Extracted from MobileAuthService.buildAuthResponse so the security-critical
 * JWT shape can be tested without DB/DI. CRITICAL (see CLAUDE.md security rules):
 * NEVER put `aud` in the payload — jsonwebtoken throws when a registered claim
 * is set both in the payload and via options. The `audience` option is the only
 * place `aud: 'mobile-app'` is added.
 */
import * as jwt from 'jsonwebtoken';

export const MOBILE_AUDIENCE = 'mobile-app';
export const ACCESS_TOKEN_TTL = '15m';
export const REFRESH_TOKEN_TTL = '30d';

export interface MobileTokenSubject {
  id: string;
  email: string;
}

export interface MobileTokens {
  accessToken: string;
  refreshToken: string;
}

/** Build the access + refresh JWTs for a Wesley Club customer. */
export function buildMobileTokens(
  subject: MobileTokenSubject,
  accessSecret: string,
  refreshSecret: string,
): MobileTokens {
  const accessToken = jwt.sign(
    { sub: subject.id, email: subject.email },
    accessSecret,
    { expiresIn: ACCESS_TOKEN_TTL, audience: MOBILE_AUDIENCE },
  );
  const refreshToken = jwt.sign(
    { sub: subject.id },
    refreshSecret,
    { expiresIn: REFRESH_TOKEN_TTL, audience: MOBILE_AUDIENCE },
  );
  return { accessToken, refreshToken };
}
