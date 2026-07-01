import * as jwt from 'jsonwebtoken';
import {
  buildMobileTokens,
  MOBILE_AUDIENCE,
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL,
} from './mobile-tokens';

const ACCESS_SECRET = 'access-secret-at-least-32-chars-long-xxxx';
const REFRESH_SECRET = 'refresh-secret-at-least-32-chars-long-yyyy';

describe('buildMobileTokens (POS mobile-auth JWT)', () => {
  it('does NOT throw (no aud duplication) and returns two tokens', () => {
    const t = buildMobileTokens({ id: 'c1', email: 'a@b.co' }, ACCESS_SECRET, REFRESH_SECRET);
    expect(typeof t.accessToken).toBe('string');
    expect(typeof t.refreshToken).toBe('string');
  });

  it('access token carries aud=mobile-app, sub, email and verifies with the audience option', () => {
    const { accessToken } = buildMobileTokens({ id: 'c1', email: 'a@b.co' }, ACCESS_SECRET, REFRESH_SECRET);
    const decoded = jwt.verify(accessToken, ACCESS_SECRET, { audience: MOBILE_AUDIENCE }) as any;
    expect(decoded.aud).toBe(MOBILE_AUDIENCE);
    expect(decoded.sub).toBe('c1');
    expect(decoded.email).toBe('a@b.co');
  });

  it('refresh token is signed with the refresh secret and carries only sub (no email)', () => {
    const { refreshToken } = buildMobileTokens({ id: 'c1', email: 'a@b.co' }, ACCESS_SECRET, REFRESH_SECRET);
    const decoded = jwt.verify(refreshToken, REFRESH_SECRET, { audience: MOBILE_AUDIENCE }) as any;
    expect(decoded.sub).toBe('c1');
    expect(decoded.email).toBeUndefined();
    // access secret must NOT verify a refresh token (distinct secrets)
    expect(() => jwt.verify(refreshToken, ACCESS_SECRET, { audience: MOBILE_AUDIENCE })).toThrow();
  });

  it('verification with a wrong audience is rejected', () => {
    const { accessToken } = buildMobileTokens({ id: 'c1', email: 'a@b.co' }, ACCESS_SECRET, REFRESH_SECRET);
    expect(() => jwt.verify(accessToken, ACCESS_SECRET, { audience: 'back-office' })).toThrow();
  });

  it('TTLs: access ≈ 15 min, refresh ≈ 30 days', () => {
    const { accessToken, refreshToken } = buildMobileTokens({ id: 'c1', email: 'a@b.co' }, ACCESS_SECRET, REFRESH_SECRET);
    const a = jwt.verify(accessToken, ACCESS_SECRET, { audience: MOBILE_AUDIENCE }) as any;
    const r = jwt.verify(refreshToken, REFRESH_SECRET, { audience: MOBILE_AUDIENCE }) as any;
    expect(a.exp - a.iat).toBe(15 * 60);
    expect(r.exp - r.iat).toBe(30 * 24 * 60 * 60);
    // constants stay in sync with the tested values
    expect(ACCESS_TOKEN_TTL).toBe('15m');
    expect(REFRESH_TOKEN_TTL).toBe('30d');
  });
});
