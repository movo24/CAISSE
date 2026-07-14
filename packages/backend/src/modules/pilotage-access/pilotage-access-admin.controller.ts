import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { SkipTenantCheck } from '../../common/interceptors/tenant.interceptor';
import { AccessAdminService, ActorContext } from './access-admin.service';
import { AccessAuditService } from './access-audit.service';
import { GrantApplicationAccessDto, GrantStoreAccessDto, SuspendDto } from './access-admin.dto';

/**
 * Administration des accès de pilotage — RÉSERVÉ à l'admin (rôle POS = central).
 * Chaque mutation est tracée dans access_audit_log (immuable). @SkipTenantCheck car
 * les opérations sont cross-magasins et cross-employés.
 */
@ApiTags('pilotage-access-admin')
@ApiBearerAuth()
@Controller('pilotage/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@SkipTenantCheck()
export class PilotageAccessAdminController {
  constructor(
    private readonly admin: AccessAdminService,
    private readonly audit: AccessAuditService,
  ) {}

  private actor(req: any): ActorContext {
    return { actorEmployeeId: req.user.employeeId, ipAddress: req.ip ?? null };
  }

  @Post('employees/:employeeId/application-access')
  @ApiOperation({ summary: "Accorder / mettre à jour l'accès application d'un employé" })
  grantApp(@Param('employeeId') employeeId: string, @Body() dto: GrantApplicationAccessDto, @Req() req: any) {
    return this.admin.grantApplicationAccess(employeeId, dto, this.actor(req));
  }

  @Post('employees/:employeeId/suspend')
  @ApiOperation({ summary: "Suspendre immédiatement l'accès d'un employé" })
  suspend(@Param('employeeId') employeeId: string, @Body() dto: SuspendDto, @Req() req: any) {
    return this.admin.suspend(employeeId, dto?.reason ?? null, this.actor(req));
  }

  @Post('employees/:employeeId/reactivate')
  @ApiOperation({ summary: "Réactiver l'accès d'un employé" })
  reactivate(@Param('employeeId') employeeId: string, @Req() req: any) {
    return this.admin.reactivate(employeeId, this.actor(req));
  }

  @Put('employees/:employeeId/stores/:storeId')
  @ApiOperation({ summary: 'Accorder / mettre à jour le périmètre magasin' })
  grantStore(
    @Param('employeeId') employeeId: string,
    @Param('storeId') storeId: string,
    @Body() dto: GrantStoreAccessDto,
    @Req() req: any,
  ) {
    return this.admin.grantStoreAccess(employeeId, storeId, dto, this.actor(req));
  }

  @Delete('employees/:employeeId/stores/:storeId')
  @ApiOperation({ summary: 'Révoquer le périmètre magasin (soft-delete)' })
  revokeStore(
    @Param('employeeId') employeeId: string,
    @Param('storeId') storeId: string,
    @Body() dto: SuspendDto,
    @Req() req: any,
  ) {
    return this.admin.revokeStoreAccess(employeeId, storeId, dto?.reason ?? null, this.actor(req));
  }

  @Get('access-audit')
  @ApiOperation({ summary: 'Journal d’audit des droits (append-only, hash-chaîné)' })
  listAudit(@Query('scope') scope?: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.audit.list(scope || 'global', limit ? +limit : 100, offset ? +offset : 0);
  }

  @Get('access-audit/verify')
  @ApiOperation({ summary: 'Vérifier l’intégrité de la chaîne d’audit des droits' })
  verifyAudit(@Query('scope') scope?: string) {
    return this.audit.verifyChain(scope || 'global');
  }
}
