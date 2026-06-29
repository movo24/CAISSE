import { Controller, Post, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { OutboxRelayService } from './outbox-relay.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

@ApiTags('integration')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('integration')
export class IntegrationController {
  constructor(private readonly relay: OutboxRelayService) {}

  @Post('relay')
  @Roles('admin')
  @ApiOperation({
    summary:
      'POS-INT-78 — flush the integration outbox (pending/retryable) via the active publisher (simulation in sandbox). Admin-only, tenant-scoped, out-of-band.',
  })
  async runRelay(@Request() req: any, @Query('limit') limit?: string) {
    const n = Math.min(Math.max(parseInt(limit ?? '100', 10) || 100, 1), 1000);
    // Tenant scope: admin flushes own store unless cross-store admin (storeId from JWT).
    return this.relay.relayBatch(n, req.user.storeId);
  }
}
