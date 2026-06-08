import { Controller, Sse, Query, UnauthorizedException, ForbiddenException, MessageEvent } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Observable } from 'rxjs';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RealtimeService } from './realtime.service';
import { SkipTenantCheck } from '../interceptors/tenant.interceptor';

/**
 * Server-Sent Events stream for live dashboards.
 *
 * Auth: the browser EventSource API cannot set headers, so the JWT is passed as
 * a `token` query param and verified here manually. Admins may subscribe to any
 * store; everyone else only to their own store.
 */
@ApiTags('realtime')
@Controller('realtime')
export class RealtimeController {
  constructor(
    private readonly realtime: RealtimeService,
    private readonly jwt: JwtService,
  ) {}

  @Sse('sales')
  @SkipTenantCheck()
  @ApiOperation({ summary: 'SSE stream of live store events (sales, returns). ?token=&storeId=' })
  sales(@Query('token') token: string, @Query('storeId') storeId: string): Observable<MessageEvent> {
    let payload: any;
    try {
      payload = this.jwt.verify(token);
    } catch {
      throw new UnauthorizedException('Token invalide ou expiré');
    }
    const target = storeId || payload?.storeId;
    if (!target) throw new ForbiddenException('storeId requis');
    if (payload?.role !== 'admin' && payload?.storeId !== target) {
      throw new ForbiddenException('Accès refusé à ce magasin');
    }
    return this.realtime.streamForStore(target);
  }
}
