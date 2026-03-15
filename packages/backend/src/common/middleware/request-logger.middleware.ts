import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Request Logger Middleware
 *
 * Logs every HTTP request with:
 * - Method + URL
 * - Response status code
 * - Duration in ms
 * - IP address
 * - User agent (truncated)
 *
 * Skips health check and Swagger endpoints to reduce noise.
 */
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

      // Extract employee info from JWT if available
      const user = (req as any).user;
      const userId = user?.employeeId || 'anon';
      const storeId = user?.storeId || '-';

      const logLine =
        `${method} ${originalUrl} ${statusCode} ${duration}ms ` +
        `[user=${userId} store=${storeId}] ${ip} "${userAgent}"`;

      if (statusCode >= 500) {
        this.logger.error(logLine);
      } else if (statusCode >= 400) {
        this.logger.warn(logLine);
      } else if (duration > 1000) {
        // Flag slow requests
        this.logger.warn(`SLOW ${logLine}`);
      } else {
        this.logger.log(logLine);
      }
    });

    next();
  }
}
