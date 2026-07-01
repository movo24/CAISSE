import { validateRequiredEnv, EnvLike } from './env-validation';

const SECRET = 'x'.repeat(32);
const base: EnvLike = {
  DATABASE_URL: 'postgres://x',
  JWT_SECRET: SECRET,
  JWT_REFRESH_SECRET: SECRET + 'r',
  NODE_ENV: 'development',
};

describe('validateRequiredEnv (POS-INT-212, boot fail-fast)', () => {
  it('passes with all required dev vars', () => {
    expect(() => validateRequiredEnv({ ...base })).not.toThrow();
  });

  it.each(['DATABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET'])('throws when %s is missing', (key) => {
    const env = { ...base }; delete env[key];
    expect(() => validateRequiredEnv(env)).toThrow(/Missing required/);
  });

  it('rejects insecure default secrets', () => {
    expect(() => validateRequiredEnv({ ...base, JWT_SECRET: 'dev-jwt-secret' })).toThrow(/insecure defaults/);
  });

  it('rejects a JWT_SECRET shorter than 32 chars', () => {
    expect(() => validateRequiredEnv({ ...base, JWT_SECRET: 'short' })).toThrow(/at least 32/);
  });

  describe('production-only checks', () => {
    const prod: EnvLike = { ...base, NODE_ENV: 'production', REDIS_URL: 'redis://x', CORS_ORIGIN: 'https://app.example.com' };
    it('passes with a well-formed prod config', () => {
      expect(() => validateRequiredEnv({ ...prod })).not.toThrow();
    });
    it('forbids TYPEORM_SYNCHRONIZE=true in prod', () => {
      expect(() => validateRequiredEnv({ ...prod, TYPEORM_SYNCHRONIZE: 'true' })).toThrow(/SYNCHRONIZE/);
    });
    it('requires REDIS_URL in prod unless ALLOW_INMEMORY_CACHE=true', () => {
      const noRedis = { ...prod }; delete noRedis.REDIS_URL;
      expect(() => validateRequiredEnv(noRedis)).toThrow(/REDIS_URL/);
      expect(() => validateRequiredEnv({ ...noRedis, ALLOW_INMEMORY_CACHE: 'true' })).not.toThrow();
    });
    it('requires an explicit non-wildcard CORS_ORIGIN in prod', () => {
      const noCors = { ...prod }; delete noCors.CORS_ORIGIN;
      expect(() => validateRequiredEnv(noCors)).toThrow(/CORS_ORIGIN must be set/);
      expect(() => validateRequiredEnv({ ...prod, CORS_ORIGIN: '*' })).toThrow(/cannot be "\*"/);
    });
    it('dev mode does NOT apply prod checks (sync/redis/cors)', () => {
      expect(() => validateRequiredEnv({ ...base, TYPEORM_SYNCHRONIZE: 'true' })).not.toThrow();
    });
  });
});
