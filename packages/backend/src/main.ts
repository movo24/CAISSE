// Load .env with override BEFORE anything else
// (prevents empty shell env vars from shadowing .env values)
import * as dotenv from 'dotenv';
dotenv.config({ override: true });

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

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      message = typeof res === 'string' ? res : (res as any).message || message;
    } else {
      // Build structured error context for monitoring
      const errorContext = {
        method: request.method,
        url: request.url,
        ip: request.ip,
        userId: request.user?.employeeId || 'anon',
        storeId: request.user?.storeId || 'unknown',
        userAgent: (request.headers?.['user-agent'] || '').substring(0, 100),
        errorName: exception instanceof Error ? exception.name : 'UnknownError',
        errorMessage: exception instanceof Error ? exception.message : String(exception),
      };

      // Never leak stack traces or internal details to clients
      this.logger.error(
        `Unhandled exception: ${JSON.stringify(errorContext)}`,
        exception instanceof Error ? exception.stack : String(exception),
      );

      // Report to Sentry if configured
      if (process.env.SENTRY_DSN) {
        Sentry.captureException(exception, { extra: errorContext });
      }
    }

    response.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      ...(process.env.NODE_ENV !== 'production' && exception instanceof Error
        ? { error: exception.name }
        : {}),
    });
  }
}

// ── Environment Validation ──────────────────────────────────────────────
function validateEnvironment() {
  const required = [
    'DATABASE_URL',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
      'Copy .env.example to .env and fill in all values.',
    );
  }
  if (process.env.JWT_SECRET === 'dev-jwt-secret' || process.env.JWT_REFRESH_SECRET === 'dev-refresh-secret') {
    throw new Error('JWT secrets must not use insecure defaults. Generate with: openssl rand -hex 32');
  }
}

// ── CORS origin parsing ─────────────────────────────────────────────────
function parseCorsOrigin(): string[] | boolean {
  const raw = process.env.CORS_ORIGIN;
  if (!raw) {
    // In dev without explicit CORS, allow common local origins
    return ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3001'];
  }
  return raw.split(',').map((o) => o.trim()).filter(Boolean);
}

async function bootstrap() {
  validateEnvironment();

  const app = await NestFactory.create(AppModule);

  // --- Security ---
  app.use(helmet());
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
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`\n  CAISSE API running on http://0.0.0.0:${port}`);
  console.log(`  Swagger docs: http://localhost:${port}/api/docs\n`);
}
bootstrap();
