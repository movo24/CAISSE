import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { Reflector } from '@nestjs/core';

/**
 * SKIP_TENANT_CHECK decorator — for public endpoints (login, plans, etc.)
 */
export const SKIP_TENANT_KEY = 'skipTenantCheck';
export const SkipTenantCheck = () =>
  (target: any, key?: string, descriptor?: PropertyDescriptor) => {
    if (descriptor) {
      Reflect.defineMetadata(SKIP_TENANT_KEY, true, descriptor.value);
    } else {
      Reflect.defineMetadata(SKIP_TENANT_KEY, true, target);
    }
    return descriptor ?? target;
  };

/**
 * TenantInterceptor
 *
 * Automatically enforces tenant isolation by:
 * 1. Extracting storeId from the authenticated JWT payload (req.user.storeId)
 * 2. Comparing it against any storeId in route params, query, or body
 * 3. Blocking requests where a user tries to access another store's data
 * 4. Injecting req.tenantStoreId for services to use
 *
 * This prevents the #1 multi-tenancy risk: a developer forgetting
 * WHERE store_id = :storeId in a query. Even if they forget, the
 * interceptor ensures the request only carries the user's own storeId.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TenantInterceptor.name);

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // Check if this endpoint opts out of tenant checking
    const skipHandler = Reflect.getMetadata(
      SKIP_TENANT_KEY,
      context.getHandler(),
    );
    const skipClass = Reflect.getMetadata(
      SKIP_TENANT_KEY,
      context.getClass(),
    );
    if (skipHandler || skipClass) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // No authenticated user = skip (public endpoint handled by guards)
    if (!user || !user.storeId) {
      return next.handle();
    }

    const jwtStoreId: string = user.storeId;

    // --- Enforce: route params ---
    if (request.params?.storeId && request.params.storeId !== jwtStoreId) {
      this.logger.warn(
        `TENANT VIOLATION: user ${user.employeeId} (store ${jwtStoreId}) ` +
          `tried to access store ${request.params.storeId} via route param`,
      );
      throw new ForbiddenException(
        'Access denied: you cannot access another store\'s data.',
      );
    }

    // --- Enforce: query string ---
    if (request.query?.storeId && request.query.storeId !== jwtStoreId) {
      this.logger.warn(
        `TENANT VIOLATION: user ${user.employeeId} (store ${jwtStoreId}) ` +
          `tried to access store ${request.query.storeId} via query`,
      );
      throw new ForbiddenException(
        'Access denied: you cannot access another store\'s data.',
      );
    }

    // --- Enforce: body ---
    if (request.body?.storeId && request.body.storeId !== jwtStoreId) {
      this.logger.warn(
        `TENANT VIOLATION: user ${user.employeeId} (store ${jwtStoreId}) ` +
          `tried to access store ${request.body.storeId} via body`,
      );
      throw new ForbiddenException(
        'Access denied: you cannot access another store\'s data.',
      );
    }

    // --- Auto-inject storeId so services always have it ---
    request.tenantStoreId = jwtStoreId;

    // Also auto-fill missing storeId in query/body so controllers
    // don't need to manually extract it from JWT
    if (request.query && !request.query.storeId) {
      request.query.storeId = jwtStoreId;
    }
    if (request.body && typeof request.body === 'object' && !request.body.storeId) {
      request.body.storeId = jwtStoreId;
    }

    return next.handle();
  }
}
