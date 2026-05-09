import { Controller, Get, Head, HttpCode, HttpStatus, HttpException, Inject, UseGuards, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PosMetrics } from '../../common/middleware/request-logger.middleware';
import { TimewinService } from '../timewin/timewin.service';
import { CACHE_STORE } from '../../common/cache/cache.module';
import { ICacheStore, ResilientCacheStore } from '../../common/cache/cache-store';
import { AlertService } from '../../common/alert/alert.service';

const HEALTH_DB_TIMEOUT_MS = 2000;

/**
 * Health-check + metrics endpoints.
 * Health is public. Metrics requires auth.
 *
 * Behaviour:
 *  - DB reachable + app responsive  → HTTP 200, status='ok' or 'degraded' (Redis/TW down)
 *  - DB unreachable                 → HTTP 503, status='down' (Railway / orchestrator must restart)
 */
@ApiTags('Health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly timewin: TimewinService,
    @Inject(CACHE_STORE) private readonly cache: ICacheStore,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Health check — honest system status (returns 503 if DB unreachable)' })
  async check(@Res({ passthrough: true }) res: Response) {
    const mem = process.memoryUsage();

    // ── DB ping (CRITICAL) — strict 2s timeout ────────────────
    let dbState: 'up' | 'down' = 'down';
    let dbError: string | null = null;
    let dbLatencyMs: number | null = null;
    const dbStart = Date.now();
    try {
      await Promise.race([
        this.dataSource.query('SELECT 1'),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('DB_PING_TIMEOUT')), HEALTH_DB_TIMEOUT_MS),
        ),
      ]);
      dbState = 'up';
      dbLatencyMs = Date.now() - dbStart;
    } catch (e: any) {
      dbState = 'down';
      dbError = (e?.message || 'unknown').slice(0, 200);
      dbLatencyMs = Date.now() - dbStart;
    }

    // ── Redis status — active probe ──────────────────────────
    const resilient = this.cache as ResilientCacheStore;
    let redisState: 'up' | 'down' | 'unknown' = 'unknown';
    if (resilient.probe) {
      const alive = await resilient.probe();
      redisState = alive ? 'up' : 'down';
    }
    const cacheStatus = resilient.getStatus?.()
      ?? { state: 'IN_MEMORY' as const, lastError: null, downSince: null, failCount: 0 };

    // ── TimeWin24 status (non-blocking, circuit breaker state) ──
    const cbState = this.timewin.getCircuitState();
    const timewinState = cbState === 'CLOSED' ? 'up'
      : cbState === 'OPEN' ? 'down'
      : 'degraded'; // HALF_OPEN

    // ── Overall status ───────────────────────────────────────
    let status: 'ok' | 'degraded' | 'down' = 'ok';
    if (dbState === 'down') {
      status = 'down';
    } else if (redisState === 'down' || timewinState === 'down') {
      status = 'degraded';
    }

    const body = {
      status,
      version: '1.1.0',
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.floor(process.uptime()),
      database: dbState,
      database_latency_ms: dbLatencyMs,
      database_error: dbError,
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

    // CRITICAL: 503 if DB unreachable so platform health checks restart the pod.
    if (dbState === 'down') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    } else {
      res.status(HttpStatus.OK);
    }
    return body;
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
