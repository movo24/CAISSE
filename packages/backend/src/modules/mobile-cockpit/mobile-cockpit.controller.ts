import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { MobileCockpitService } from './mobile-cockpit.service';

/**
 * POS-110/112 — Mobile supervision cockpit (READ-ONLY).
 *
 * Guarded by the EMPLOYEE JWT + RolesGuard (manager/admin) — deliberately NOT the
 * customer mobile token (MobileAuthGuard), so store alerts are never exposed to customers.
 * No mutating action is exposed from this endpoint (POS-113).
 */
@ApiTags('mobile-cockpit')
@ApiBearerAuth()
@Controller('mobile/v1')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MobileCockpitController {
  constructor(private readonly service: MobileCockpitService) {}

  @Get('alerts')
  @Roles('manager')
  @ApiOperation({
    summary:
      'Read-only supervision alerts (stock + sale anomalies). Manager/admin only, tenant-scoped.',
  })
  getAlerts(@Req() req: any, @Query('storeId') storeId?: string) {
    const effectiveStoreId =
      req.user.role === 'admin' && storeId ? storeId : req.user.storeId;
    return this.service.getAlerts(effectiveStoreId);
  }
}
