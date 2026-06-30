/**
 * POS-INT-123 — jest global setup.
 *
 * Force the in-memory cache in tests so no spec opens a real Redis socket.
 * `.env` ships REDIS_URL=redis://localhost:6380; ConfigModule.forRoot() loads it
 * via dotenv, which makes ResilientCacheStore retry a (absent) Redis and, under
 * parallel workers, flake (ECONNREFUSED races). Pre-setting REDIS_URL='' here
 * means dotenv won't override it (it never overrides already-defined keys) and
 * the CacheModule factory treats '' as falsy → InMemoryCacheStore. Test-only.
 */
process.env.REDIS_URL = '';
