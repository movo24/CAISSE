import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * @TenantStoreId() parameter decorator
 *
 * Extracts the authenticated user's storeId from the request.
 * This is the SAFE way to get the storeId in controllers —
 * it always comes from the JWT, never from user input.
 *
 * Usage:
 *   @Get('products')
 *   findAll(@TenantStoreId() storeId: string) {
 *     return this.productsService.findAll(storeId);
 *   }
 */
export const TenantStoreId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();

    // Priority: tenantStoreId (set by interceptor) > user.storeId (JWT)
    const storeId = request.tenantStoreId || request.user?.storeId;

    if (!storeId) {
      throw new Error(
        'TenantStoreId: no storeId found. Ensure JwtAuthGuard is applied.',
      );
    }

    return storeId;
  },
);
