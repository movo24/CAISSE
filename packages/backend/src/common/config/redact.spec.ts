import { maskSecret, redactForLog } from './redact';
import { validateRequiredEnv, EnvLike } from './env-validation';

describe('redact (POS-INT-232)', () => {
  it('maskSecret fully hides any value, keeps empty empty', () => {
    expect(maskSecret('sk_live_supersecret')).toBe('***');
    expect(maskSecret('x')).toBe('***');
    expect(maskSecret('')).toBe('');
    expect(maskSecret(undefined)).toBe('');
  });

  it('redactForLog exposes names + masked values only, never the value', () => {
    const out = redactForLog({ JWT_SECRET: 'topsecretvalue', REDIS_URL: undefined }, ['JWT_SECRET', 'REDIS_URL']);
    expect(out).toEqual({ JWT_SECRET: '***', REDIS_URL: '(unset)' });
    expect(JSON.stringify(out)).not.toContain('topsecretvalue');
  });
});

describe('env validation never leaks secret VALUES in error messages (POS-INT-232)', () => {
  const SECRET_VALUE = 's3cr3t-value-that-must-not-be-logged';

  it('short JWT_SECRET → message mentions the name, not the value', () => {
    try {
      validateRequiredEnv({ DATABASE_URL: 'x', JWT_SECRET: SECRET_VALUE.slice(0, 10), JWT_REFRESH_SECRET: 'y'.repeat(32), NODE_ENV: 'development' } as EnvLike);
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e.message).toMatch(/JWT_SECRET/);
      expect(e.message).not.toContain(SECRET_VALUE.slice(0, 10));
    }
  });

  it('missing vars → lists NAMES only', () => {
    try {
      validateRequiredEnv({ NODE_ENV: 'development' } as EnvLike);
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e.message).toContain('DATABASE_URL');
      expect(e.message).toContain('JWT_SECRET');
      // no value present because they were unset — sanity: message has no '=' assignment leak
      expect(e.message).not.toMatch(/=\s*\S+secret/i);
    }
  });
});
