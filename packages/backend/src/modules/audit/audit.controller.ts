import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

@ApiTags('audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('audit')
export class AuditController {
  constructor(private auditService: AuditService) {}

  /**
   * Resolve which store's audit chain to read.
   *
   * Only an admin may target a store other than their own (e.g. the global
   * '_admin' chain that holds store-less admin_login events). Any other role
   * is hard-locked to its own store — the ?storeId param is ignored, never
   * trusted, so a manager can never read another store's audit log.
   */
  private resolveStoreId(req: any, requested?: string): string {
    if (requested && req.user.role === 'admin') {
      return requested;
    }
    return req.user.storeId;
  }

  @Get()
  @Roles('admin', 'manager')
  @ApiOperation({
    summary: 'Get audit log entries (admin may pass ?storeId, e.g. _admin)',
  })
  getEntries(
    @Request() req: any,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('storeId') storeId?: string,
  ) {
    return this.auditService.getEntries(
      this.resolveStoreId(req, storeId),
      limit ? parseInt(limit) : 100,
      offset ? parseInt(offset) : 0,
    );
  }

  @Get('verify')
  @Roles('admin')
  @ApiOperation({
    summary: 'Verify audit chain integrity (admin may pass ?storeId, e.g. _admin)',
  })
  verifyChain(@Request() req: any, @Query('storeId') storeId?: string) {
    return this.auditService.verifyChain(this.resolveStoreId(req, storeId));
  }
}
