// Load .env BEFORE anything else.
// On production (Railway / Vercel), env vars come from the platform —
// no .env file is shipped. dotenv finds nothing → no-op.
// In dev, .env supplies missing vars but does NOT override shell vars.
import * as dotenv from 'dotenv';
dotenv.config();

// --- Sentry: must initialize BEFORE other imports ---
import * as Sentry from '@sentry/node';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.npm_package_version || '0.1.0',
    // Sample 20% of transactions in prod, 100% in dev
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
    sendDefaultPii: false,
  });
}

import { NestFactory, Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  ValidationPipe,
  HttpException,
  HttpStatus,
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  Logger,
} from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { TenantInterceptor } from './common/interceptors/tenant.interceptor';
import { BusinessError } from './common/errors/business-error';

// ── Global Exception Filter — sanitize error responses ──────────────────
// Reports unhandled exceptions to Sentry (when SENTRY_DSN is set).
// Never leaks stack traces or internal details to API consumers.
@Catch()
class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    // ── 1. BusinessError — already carries the structured payload ──
    if (exception instanceof BusinessError) {
      const body = exception.getResponse() as Record<string, any>;
      response.status(exception.getStatus()).json(body);
      return;
    }

    // ── 2. Regular HttpException (including class-validator) ──
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();

      // class-validator pipes return { message: string[], error, statusCode }
      const isValidation =
        typeof res === 'object' &&
        res !== null &&
        Array.isArray((res as any).message);

      if (isValidation) {
        response.status(status).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: 'Erreur de validation.',
          statusCode: status,
          details: (res as any).message,
        });
        return;
      }

      // Any other HttpException. Préserve un `code`/`reason` métier si l'exception en fournit un
      // (ex. StoreAccessGuard → FORBIDDEN/ACCOUNT_SUSPENDED/ACCESS_EXPIRED, spec §5) ; sinon HTTP_ERROR.
      const resObj: any = typeof res === 'object' && res !== null ? res : {};
      const message =
        typeof res === 'string' ? res : resObj.message || 'Internal server error';
      response.status(status).json({
        success: false,
        code: typeof resObj.code === 'string' ? resObj.code : 'HTTP_ERROR',
        message,
        statusCode: status,
        ...(resObj.reason ? { reason: resObj.reason } : {}),
      });
      return;
    }

    // ── 2b. Corps de requête trop volumineux (body-parser, hors pipeline Nest) ──
    // Sans ce cas, une photo produit trop lourde ressortait en 500
    // « Internal server error » inexploitable côté Back-Office.
    if (exception instanceof Error && exception.name === 'PayloadTooLargeError') {
      response.status(HttpStatus.PAYLOAD_TOO_LARGE).json({
        success: false,
        code: 'PAYLOAD_TOO_LARGE',
        message:
          'Requête trop volumineuse — l’image dépasse la taille maximale acceptée. Réduisez la photo et réessayez.',
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
      });
      return;
    }

    // ── 3. Unknown / unhandled errors ──
    const errorContext = {
      method: request.method,
      url: request.url,
      ip: request.ip,
      userId: request.user?.employeeId || 'anon',
      storeId: request.user?.storeId || 'unknown',
      userAgent: (request.headers?.['user-agent'] || '').substring(0, 100),
      errorName: exception instanceof Error ? exception.name : 'UnknownError',
      errorMessage:
        exception instanceof Error ? exception.message : String(exception),
    };

    this.logger.error(
      `Unhandled exception: ${JSON.stringify(errorContext)}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    if (process.env.SENTRY_DSN) {
      Sentry.captureException(exception, { extra: errorContext });
    }

    const status = HttpStatus.INTERNAL_SERVER_ERROR;
    response.status(status).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      statusCode: status,
      ...(process.env.NODE_ENV !== 'production' && exception instanceof Error
        ? { details: exception.name }
        : {}),
    });
  }
}

// ── Environment Validation ──────────────────────────────────────────────
function validateEnvironment() {
  const logger = new Logger('EnvValidation');

  // Critical secrets — app MUST NOT start without these
  const required = [
    'DATABASE_URL',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `FATAL: Missing required environment variables: ${missing.join(', ')}. ` +
      'Copy .env.example to .env and fill in all values.',
    );
  }

  // Reject insecure defaults
  if (process.env.JWT_SECRET === 'dev-jwt-secret' || process.env.JWT_REFRESH_SECRET === 'dev-refresh-secret') {
    throw new Error('JWT secrets must not use insecure defaults. Generate with: openssl rand -hex 32');
  }

  // Minimum secret length
  if (process.env.JWT_SECRET!.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }
  if (process.env.JWT_REFRESH_SECRET!.length < 32) {
    throw new Error('JWT_REFRESH_SECRET must be at least 32 characters');
  }
  // Access and refresh secrets MUST differ — otherwise a 15m access token and a
  // 7d refresh token become interchangeable material (weakens replay defence).
  if (process.env.JWT_SECRET === process.env.JWT_REFRESH_SECRET) {
    throw new Error('JWT_REFRESH_SECRET must be different from JWT_SECRET');
  }

  // Production-only checks
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd) {
    if (process.env.TYPEORM_SYNCHRONIZE === 'true') {
      throw new Error('FATAL: TYPEORM_SYNCHRONIZE=true is forbidden in production');
    }
    // REDIS_URL is required in production (token revocation / OTP / rate-limit must
    // be shared across instances). A single-pod deployment can consciously opt out
    // of Redis with ALLOW_INMEMORY_CACHE=true — otherwise we fail fast.
    if (!process.env.REDIS_URL) {
      if (process.env.ALLOW_INMEMORY_CACHE === 'true') {
        logger.warn('REDIS_URL not set — in-memory cache (ALLOW_INMEMORY_CACHE=true). NOT multi-instance safe.');
      } else {
        throw new Error(
          'REDIS_URL must be set in production (shared cache for token revocation / OTP / rate-limit). ' +
            'For a single-pod deployment only, set ALLOW_INMEMORY_CACHE=true to opt out.',
        );
      }
    }
    if (!process.env.TIMEWIN24_API_KEY) {
      logger.warn('TIMEWIN24_API_KEY not set — TimeWin24 integration disabled');
    }
    // CORS is strict in production: credentials are enabled, so a wildcard or an
    // unset origin is a security hole — fail fast rather than ship it.
    if (!process.env.CORS_ORIGIN) {
      throw new Error(
        'CORS_ORIGIN must be set to an explicit, comma-separated origin list in production (credentials are enabled)',
      );
    }
    if (process.env.CORS_ORIGIN.trim() === '*') {
      throw new Error(
        'CORS_ORIGIN cannot be "*" in production — a wildcard with credentials is unsafe',
      );
    }
  }

  // Warnings for recommended settings
  if (!process.env.REDIS_URL) {
    logger.warn('REDIS_URL not set — rate limiting and token revocation will be in-memory only (not multi-instance safe)');
  }
  if (!process.env.SENTRY_DSN) {
    logger.warn('SENTRY_DSN not set — error tracking disabled');
  }
  if (!process.env.TIMEWIN24_URL) {
    logger.warn('TIMEWIN24_URL not set — TimeWin24 integration disabled');
  }
}

// ── CORS origin parsing ─────────────────────────────────────────────────
function parseCorsOrigin(): string[] | boolean {
  const raw = process.env.CORS_ORIGIN;
  if (!raw) {
    // Dev only (production requires an explicit CORS_ORIGIN — enforced at boot).
    return ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3001'];
  }
  if (raw.trim() === '*') {
    // Dev convenience only — reflect any origin. Production rejects '*' at boot.
    return true;
  }
  return raw.split(',').map((o) => o.trim()).filter(Boolean);
}

// Map LOG_LEVEL env to NestJS log levels
function getLogLevels(): ('log' | 'error' | 'warn' | 'debug' | 'verbose')[] {
  const level = (process.env.LOG_LEVEL || 'info').toLowerCase();
  switch (level) {
    case 'error': return ['error'];
    case 'warn': return ['error', 'warn'];
    case 'info': return ['error', 'warn', 'log'];
    case 'debug': return ['error', 'warn', 'log', 'debug'];
    case 'verbose': return ['error', 'warn', 'log', 'debug', 'verbose'];
    default: return ['error', 'warn', 'log'];
  }
}

async function bootstrap() {
  validateEnvironment();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true, // Required for Stripe webhook signature verification
    logger: getLogLevels(),
  });

  // Les fiches produit portent leur photo en data-URL dans le JSON (stockage
  // existant, colonne text). Le défaut body-parser (100kb) rejetait donc TOUT
  // enregistrement avec image en PayloadTooLargeError rendu « Internal server
  // error ». Borne haute volontairement contenue : le front compresse ≤ ~500kb.
  app.useBodyParser('json', { limit: '6mb' });
  app.useBodyParser('urlencoded', { limit: '6mb', extended: true });

  // --- Trust proxy ---
  // Behind Railway/Cloudflare, the client IP is in X-Forwarded-For. Trust a
  // BOUNDED number of front proxies (default 1) so req.ip and the per-IP rate
  // limiter / login lockout see the real client — NOT `true`, which would let a
  // client spoof its IP via a forged XFF header. TRUST_PROXY_HOPS tunes the count.
  const trustProxyHops = parseInt(process.env.TRUST_PROXY_HOPS || '1', 10);
  app.getHttpAdapter().getInstance().set('trust proxy', trustProxyHops);

  // --- Security ---
  // Helmet security headers — CSP disabled for API (APIs don't serve HTML pages).
  // CSP should be set by the frontend nginx configs, not by the JSON API.
  app.use(helmet({
    contentSecurityPolicy: false, // API returns JSON, not HTML — CSP not applicable
    hsts: {
      maxAge: 63072000,
      includeSubDomains: true,
      preload: true,
    },
  }));
  app.use(cookieParser());
  app.enableCors({
    origin: parseCorsOrigin(),
    credentials: true,
  });

  // --- Global prefix ---
  app.setGlobalPrefix('api');

  // --- Global pipes ---
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // --- Global filters ---
  app.useGlobalFilters(new GlobalExceptionFilter());

  // --- Global interceptors ---
  const reflector = app.get(Reflector);
  app.useGlobalInterceptors(new TenantInterceptor(reflector));

  // --- Swagger ---
  const config = new DocumentBuilder()
    .setTitle('CAISSE API')
    .setDescription(
      'Modern POS System API - Multi-store, multi-currency, AI-powered',
    )
    .setVersion('0.2.0')
    .addBearerAuth()
    .build();
  // Swagger exposes the full API surface — keep it off in production unless
  // explicitly enabled (ENABLE_SWAGGER=true), to avoid handing attackers a map.
  if (process.env.NODE_ENV !== 'production' || process.env.ENABLE_SWAGGER === 'true') {
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env.PORT || 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`\n  CAISSE API running on http://0.0.0.0:${port}`);
  console.log(`  Swagger docs: http://localhost:${port}/api/docs\n`);
}
bootstrap();
