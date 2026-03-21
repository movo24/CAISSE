import { Global, Module, Logger } from '@nestjs/common';
import { InMemoryCacheStore, ResilientCacheStore, ICacheStore } from './cache-store';
import { AlertService } from '../alert/alert.service';

export const CACHE_STORE = 'CACHE_STORE';

/**
 * CacheModule — provides ICacheStore globally.
 *
 * Strategy:
 *   - If REDIS_URL is set → ResilientCacheStore (Redis primary, in-memory fallback, fail-fast)
 *   - Otherwise → InMemoryCacheStore (single-instance only)
 */
@Global()
@Module({
  providers: [
    {
      provide: CACHE_STORE,
      useFactory: (): ICacheStore => {
        const logger = new Logger('CacheModule');
        const redisUrl = process.env.REDIS_URL;

        if (redisUrl) {
          logger.log(`Using resilient Redis cache: ${redisUrl.replace(/\/\/.*@/, '//***@')}`);
          return new ResilientCacheStore(redisUrl, {
            failThreshold: 2,
            healthCheckIntervalMs: 5_000,
            onStateChange: (state, error) => {
              if (state === 'FALLBACK') {
                AlertService.instance.fire('REDIS_DOWN', `Redis DOWN: ${error}`);
              } else {
                AlertService.instance.fire('REDIS_RECOVERED', 'Redis recovered');
              }
            },
          });
        }

        logger.warn('REDIS_URL not set — using in-memory cache (not safe for multi-instance)');
        return new InMemoryCacheStore();
      },
    },
  ],
  exports: [CACHE_STORE],
})
export class CacheModule {}
