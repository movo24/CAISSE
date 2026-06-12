import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';

/**
 * INV-1 (structural) — the mobile cockpit API is GET-only. This guard rejects ANY
 * non-GET HTTP method with 405, regardless of the handlers a controller declares:
 * even a mistakenly-added @Post/@Put/@Patch/@Delete can never serve a mutation.
 * Read-only by construction, not by convention.
 */
@Injectable()
export class ReadOnlyGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ method?: string }>();
    const method = (req?.method || '').toUpperCase();
    if (method !== 'GET') {
      throw new HttpException(
        `Method ${method || '(none)'} not allowed — the mobile cockpit API is GET-only`,
        HttpStatus.METHOD_NOT_ALLOWED,
      );
    }
    return true;
  }
}
