import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Request Logger Middleware — structured JSON logs + metrics
 *
 * Outputs structured JSON for production log aggregation (ELK, CloudWatch, etc.)
 * Tracks in-memory metrics for /api/health/metrics endpoint.
 */

// ── In-memory metrics (reset on restart, scraped by health endpoint) ──
export class PosMetrics {
  private static _instance: PosMetrics;
  static get instance(): PosMetrics {
    if (!PosMetrics._instance) PosMetrics._instance = new PosMetrics();
    return PosMetrics._instance;
  }

  totalRequests = 0;
  totalSales = 0;
  totalErrors = 0;
  loginFailed = 0;
  rateLimitTriggered = 0;
  latencySum = 0;
  latencyCount = 0;
  latencyMax = 0;
  statusCounts: Record<string, number> = {};
  startedAt = Date.now();

  // Sliding window: last 60 seconds
  private salesWindow: number[] = [];
  private errorWindow: number[] = [];
  private requestWindow: number[] = [];

  recordRequest(status: number, durationMs: number, isSale: boolean, path?: string) {
    this.totalRequests++;
    this.latencySum += durationMs;
    this.latencyCount++;
    if (durationMs > this.latencyMax) this.latencyMax = durationMs;

    const bucket = `${Math.floor(status / 100)}xx`;
    this.statusCounts[bucket] = (this.statusCounts[bucket] || 0) + 1;

    const now = Date.now();
    this.requestWindow.push(now);

    if (status >= 500) {
      this.totalErrors++;
      this.errorWindow.push(now);
    }
    if (status === 429) {
      this.rateLimitTriggered++;
    }
    if (status === 401 && path?.includes('/login')) {
      this.loginFailed++;
    }
    if (isSale && status < 400) {
      this.totalSales++;
      this.salesWindow.push(now);
    }

    // Trim windows to last 60s
    const cutoff = now - 60_000;
    this.salesWindow = this.salesWindow.filter(t => t > cutoff);
    this.errorWindow = this.errorWindow.filter(t => t > cutoff);
    this.requestWindow = this.requestWindow.filter(t => t > cutoff);
  }

  getSnapshot() {
    const uptimeSec = Math.floor((Date.now() - this.startedAt) / 1000);
    return {
      uptime_seconds: uptimeSec,
      total_requests: this.totalRequests,
      total_sales: this.totalSales,
      total_errors: this.totalErrors,
      login_failed: this.loginFailed,
      rate_limit_triggered: this.rateLimitTriggered,
      req_per_minute: this.requestWindow.length,
      sales_per_minute: this.salesWindow.length,
      errors_per_minute: this.errorWindow.length,
      avg_latency_ms: this.latencyCount > 0 ? Math.round(this.latencySum / this.latencyCount) : 0,
      max_latency_ms: this.latencyMax,
      error_rate_pct: this.totalRequests > 0 ? parseFloat((this.totalErrors / this.totalRequests * 100).toFixed(2)) : 0,
      status_codes: this.statusCounts,
    };
  }
}

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    // Skip noisy endpoints
    if (req.originalUrl.includes('/health') || req.originalUrl.includes('/api/docs')) {
      return next();
    }

    const start = Date.now();
    const { method, originalUrl, ip } = req;
    const userAgent = (req.get('user-agent') || '').substring(0, 80);

    res.on('finish', () => {
      const duration = Date.now() - start;
      const { statusCode } = res;

      const user = (req as any).user;
      const userId = user?.employeeId || 'anon';
      const storeId = user?.storeId || '-';

      const isSale = method === 'POST' && originalUrl === '/api/sales';

      // Record metrics
      PosMetrics.instance.recordRequest(statusCode, duration, isSale, originalUrl);

      // Structured log entry
      const entry = {
        ts: new Date().toISOString(),
        method,
        path: originalUrl,
        status: statusCode,
        ms: duration,
        user: userId,
        store: storeId,
        ip,
        ua: userAgent,
      };

      if (statusCode >= 500) {
        this.logger.error(JSON.stringify(entry));
      } else if (statusCode >= 400 || duration > 1000) {
        this.logger.warn(JSON.stringify(entry));
      } else {
        this.logger.log(JSON.stringify(entry));
      }
    });

    next();
  }
}
