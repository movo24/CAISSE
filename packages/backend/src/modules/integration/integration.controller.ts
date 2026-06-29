import { Controller, Get, Post, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { OutboxRelayService } from './outbox-relay.service';
import { OutboxQueryService } from './outbox-query.service';
import { ReconciliationService } from './reconciliation.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

@ApiTags('integration')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('integration')
export class IntegrationController {
  constructor(
    private readonly relay: OutboxRelayService,
    private readonly queryService: OutboxQueryService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  @Get('reconciliation')
  @Roles('admin', 'manager')
  @ApiOperation({
    summary:
      'POS-INT-81 — POS↔TimeWin presence reconciliation for the store today (POS sessions vs TimeWin shifts, degrades gracefully if TW24 unreachable). Tenant-scoped, read-only.',
  })
  async reconciliationToday(@Request() req: any, @Query('employeeId') employeeId?: string) {
    return this.reconciliation.reconcileToday(req.user.storeId, employeeId);
  }

  @Get('events')
  @Roles('admin', 'manager')
  @ApiOperation({
    summary:
      'POS-INT-80 — incremental consumer feed of the integration outbox for Analytik R & co. ?since=<ISO occurredAt cursor>&type=a,b&limit=. Tenant-scoped, read-only.',
  })
  async events(
    @Request() req: any,
    @Query('since') since?: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
  ) {
    return this.queryService.listForConsumer(req.user.storeId, { since, type, limit });
  }

  @Get('shifts')
  @Roles('admin', 'manager')
  @ApiOperation({
    summary:
      'POS-INT-107/109 — cash-session shift amplitude for the store on a day (?date=YYYY-MM-DD&format=csv|json): per-shift open→close records + per-employee worked-minute totals. Tenant-scoped, read-only (TimeWin presence / Analytik R).',
  })
  async shifts(@Request() req: any, @Query('date') date: string, @Query('format') format?: string) {
    return format === 'csv'
      ? this.queryService.shiftsForDayCsv(req.user.storeId, date)
      : this.queryService.shiftsForDay(req.user.storeId, date);
  }

  @Get('stock-signals')
  @Roles('admin', 'manager')
  @ApiOperation({
    summary:
      'POS-INT-119 — stock replenishment signals for the store on a day (?date=YYYY-MM-DD): per-product latest quantity + status (ok/low/depleted), ranked by urgency. Tenant-scoped, read-only (Analytik R).',
  })
  async stockSignals(@Request() req: any, @Query('date') date: string) {
    return this.queryService.stockSignalsForDay(req.user.storeId, date);
  }

  @Get('outbox/stats')
  @Roles('admin', 'manager')
  @ApiOperation({
    summary:
      'POS-INT-91 — outbox delivery stats for the store (counts per status/type + backlog). Monitoring; tenant-scoped, read-only.',
  })
  async outboxStats(@Request() req: any) {
    return this.queryService.stats(req.user.storeId);
  }

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
