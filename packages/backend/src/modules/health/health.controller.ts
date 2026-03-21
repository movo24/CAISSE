import { Controller, Get, Head, HttpCode, HttpStatus, Inject, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PosMetrics } from '../../common/middleware/request-logger.middleware';
import { TimewinService } from '../timewin/timewin.service';
import { CACHE_STORE } from '../../common/cache/cache.module';
import { ICacheStore, ResilientCacheStore } from '../../common/cache/cache-store';
import { AlertService } from '../../common/alert/alert.service';

/**
 * Health-check + metrics endpoints.
 * Health is public. Metrics requires auth.
 */
@ApiTags('Health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly timewin: TimewinService,
    @Inject(CACHE_STORE) private readonly cache: ICacheStore,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Health check — honest system status' })
  async check() {
    const mem = process.memoryUsage();

    // Redis status — active probe (not cached state)
    const resilient = this.cache as ResilientCacheStore;
    let redisState: 'up' | 'down' | 'unknown' = 'unknown';
    if (resilient.probe) {
      const alive = await resilient.probe();
      redisState = alive ? 'up' : 'down';
    }
    const cacheStatus = resilient.getStatus?.()
      ?? { state: 'IN_MEMORY' as const, lastError: null, downSince: null, failCount: 0 };

    // TimeWin24 status (quick, non-blocking)
    const cbState = this.timewin.getCircuitState();
    const timewinState = cbState === 'CLOSED' ? 'up'
      : cbState === 'OPEN' ? 'down'
      : 'degraded'; // HALF_OPEN

    // Overall status
    let status: 'ok' | 'degraded' | 'down' = 'ok';
    if (redisState === 'down' || timewinState === 'down') {
      status = 'degraded';
    }

    return {
      status,
      version: '1.1.0',
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.floor(process.uptime()),
      redis: redisState,
      fallback_active: cacheStatus.state === 'FALLBACK',
      redis_error: cacheStatus.lastError,
      redis_down_since: cacheStatus.downSince,
      timewin: timewinState,
      circuit_breaker: cbState,
      memory: {
        rss_mb: Math.round(mem.rss / 1024 / 1024),
        heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
        heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
      },
      recent_alerts: AlertService.instance.getRecent(5),
    };
  }

  @Get('metrics')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'POS metrics (auth required)' })
  metrics() {
    const snapshot = PosMetrics.instance.getSnapshot();
    return {
      ...snapshot,
      // Additional computed fields
      req_per_sec: snapshot.uptime_seconds > 0
        ? parseFloat((snapshot.total_requests / snapshot.uptime_seconds).toFixed(2))
        : 0,
      errors_per_sec: snapshot.uptime_seconds > 0
        ? parseFloat((snapshot.total_errors / snapshot.uptime_seconds).toFixed(4))
        : 0,
    };
  }

  @Head()
  @HttpCode(HttpStatus.OK)
  head() {
    return;
  }
}
