import { Global, Module } from '@nestjs/common';
import { InMemoryCacheStore, ICacheStore } from './cache-store';

export const CACHE_STORE = 'CACHE_STORE';

/**
 * CacheModule — provides ICacheStore globally.
 *
 * Current: InMemoryCacheStore (zero dependencies, single-instance).
 *
 * To switch to Redis:
 *   1. npm install ioredis
 *   2. Uncomment RedisCacheStore in cache-store.ts
 *   3. Change the provider below:
 *      useFactory: () => new RedisCacheStore(process.env.REDIS_URL)
 *   4. Add REDIS_URL to .env
 */
@Global()
@Module({
  providers: [
    {
      provide: CACHE_STORE,
      useFactory: () => {
        // Swap to RedisCacheStore here for multi-instance deployments
        return new InMemoryCacheStore();
      },
    },
  ],
  exports: [CACHE_STORE],
})
export class CacheModule {}
