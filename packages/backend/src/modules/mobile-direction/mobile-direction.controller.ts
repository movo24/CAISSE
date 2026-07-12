import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { MobileDirectionService } from './mobile-direction.service';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_COMPARE_STORES = 10;

/**
 * Wesley Control — read-only direction/network KPI API (mobile).
 *
 * - EMPLOYEE JWT + RolesGuard (manager/admin) — never the customer mobile token.
 * - GET-only controller: no mutation is exposed, per the read-only-first rule
 *   of the direction app (no price change, no stock change, no sale change).
 * - Scoping: every handler resolves the caller's accessible store ids first
 *   (admin: all active stores; manager: home store + explicit grants) and
 *   passes that scope to the service. A store id outside the scope yields the
 *   same 404 as a non-existent store (anti-enumeration) + a server-side WARN.
 */
@ApiTags('mobile-direction')
@ApiBearerAuth()
@Controller('mobile/v1/direction')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MobileDirectionController {
  private readonly logger = new Logger(MobileDirectionController.name);

  constructor(private readonly service: MobileDirectionService) {}

  @Get('overview')
  @Roles('manager')
  @ApiOperation({
    summary:
      'Network overview — consolidated day KPIs over every store the caller may read.',
  })
  async overview(@Req() req: any, @Query('date') date?: string) {
    const day = this.validDay(date);
    const scope = await this.service.accessibleStoreIds(req.user);
    return this.service.overview(scope, day);
  }

  @Get('stores')
  @Roles('manager')
  @ApiOperation({
    summary: 'Per-store day KPIs for every store in the caller scope.',
  })
  async stores(@Req() req: any, @Query('date') date?: string) {
    const day = this.validDay(date);
    const scope = await this.service.accessibleStoreIds(req.user);
    return this.service.storeList(scope, day);
  }

  @Get('stores/:id')
  @Roles('manager')
  @ApiOperation({
    summary:
      'Store detail — hourly revenue, payments, top products, refunds, cash, terminals.',
  })
  async storeDetail(
    @Param('id') id: string,
    @Req() req: any,
    @Query('date') date?: string,
  ) {
    const day = this.validDay(date);
    const scope = await this.service.accessibleStoreIds(req.user);
    this.ensureInScope(id, scope, req);
    return this.service.storeDetail(id, day);
  }

  @Get('compare')
  @Roles('manager')
  @ApiOperation({
    summary: `Compare up to ${MAX_COMPARE_STORES} stores over a date range (in-scope only).`,
  })
  async compare(
    @Req() req: any,
    @Query('storeIds') storeIds?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const fromDay = this.validDay(from);
    const toDay = this.validDay(to);
    if (toDay < fromDay) {
      throw new BadRequestException('to must be >= from');
    }
    const requested = (storeIds ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (requested.length === 0) {
      throw new BadRequestException('storeIds is required (comma-separated)');
    }
    if (requested.length > MAX_COMPARE_STORES) {
      throw new BadRequestException(
        `storeIds: ${MAX_COMPARE_STORES} stores max`,
      );
    }
    if (requested.some((id) => !UUID.test(id))) {
      throw new BadRequestException('storeIds: invalid store id');
    }
    const scope = await this.service.accessibleStoreIds(req.user);
    for (const id of requested) this.ensureInScope(id, scope, req);
    return this.service.compare(requested, fromDay, toDay);
  }

  // ── helpers ──────────────────────────────────────────────────────────

  /** Default: today (server date). Rejects malformed dates (400). */
  private validDay(date?: string): string {
    if (date === undefined || date === '') {
      return new Date().toISOString().slice(0, 10);
    }
    if (!ISO_DAY.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
      throw new BadRequestException('date must be YYYY-MM-DD');
    }
    return date;
  }

  /**
   * Out-of-scope store id → the DEFAULT 404 (body identical to a genuinely
   * missing store — no existence leak). The forge attempt is the audit signal,
   * logged server-side.
   */
  private ensureInScope(storeId: string, scope: string[], req: any): void {
    if (!scope.includes(storeId)) {
      this.logger.warn(
        `[direction] out-of-scope store request — user=${req?.user?.employeeId ?? 'unknown'} store=${storeId}`,
      );
      throw new NotFoundException();
    }
  }
}
