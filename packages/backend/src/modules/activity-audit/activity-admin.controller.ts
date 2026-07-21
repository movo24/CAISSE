import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { SkipTenantCheck } from '../../common/interceptors/tenant.interceptor';
import { ActivityService } from './activity.service';
import { AccessAuditService } from '../pilotage-access/access-audit.service';

/**
 * Consultation admin des connexions / sessions + révocation de sessions.
 * RÉSERVÉ à l'admin (spec §15 : journaux réservés aux rôles autorisés — un directeur ne
 * peut pas lire l'historique d'un autre responsable). Révocations tracées dans access_audit_log.
 */
@ApiTags('activity-admin')
@ApiBearerAuth()
@Controller('activity')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@SkipTenantCheck()
export class ActivityAdminController {
  constructor(
    private readonly activity: ActivityService,
    private readonly audit: AccessAuditService,
  ) {}

  @Get('login-events')
  @ApiOperation({ summary: 'Journal des connexions (filtres + pagination)' })
  loginEvents(
    @Query('employeeId') employeeId?: string,
    @Query('success') success?: string,
    @Query('method') method?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.activity.listLoginEvents(
      {
        employeeId,
        success: success === undefined ? undefined : success === 'true',
        method,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
      },
      page ? +page : 1,
      limit ? +limit : 50,
    );
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Sessions (actives ou toutes) par employé' })
  sessions(@Query('employeeId') employeeId?: string, @Query('activeOnly') activeOnly?: string) {
    return this.activity.listSessions({ employeeId, activeOnly: activeOnly === 'true' });
  }

  @Get('view-events')
  @ApiOperation({ summary: 'Journal des consultations (filtres + pagination)' })
  viewEvents(
    @Query('employeeId') employeeId?: string,
    @Query('storeId') storeId?: string,
    @Query('module') module?: string,
    @Query('action') action?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.activity.listViewEvents(
      {
        employeeId,
        storeId,
        module,
        action,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
      },
      page ? +page : 1,
      limit ? +limit : 50,
    );
  }

  @Get('employees/:employeeId/stats')
  @ApiOperation({ summary: 'Statistiques de connexion d’un employé' })
  stats(@Param('employeeId') employeeId: string) {
    return this.activity.sessionStats(employeeId);
  }

  @Post('sessions/:sessionId/revoke')
  @ApiOperation({ summary: 'Révoquer une session (tracé SESSION_REVOKED)' })
  async revokeSession(@Param('sessionId') sessionId: string, @Body('reason') reason: string | undefined, @Req() req: any) {
    const { employeeId } = await this.activity.revokeSession(sessionId, req.user.employeeId, reason || 'admin_revoke');
    await this.audit.append({
      actorEmployeeId: req.user.employeeId,
      targetEmployeeId: employeeId,
      eventType: 'SESSION_REVOKED',
      sessionId,
      reason: reason ?? null,
      ipAddress: req.ip ?? null,
    });
    return { revoked: true, sessionId };
  }

  @Post('employees/:employeeId/revoke-sessions')
  @ApiOperation({ summary: 'Révoquer toutes les sessions d’un employé (tracé ALL_SESSIONS_REVOKED)' })
  async revokeAll(@Param('employeeId') employeeId: string, @Body('reason') reason: string | undefined, @Req() req: any) {
    const count = await this.activity.revokeAllSessionsForEmployee(employeeId, req.user.employeeId, reason || 'admin_revoke_all');
    await this.audit.append({
      actorEmployeeId: req.user.employeeId,
      targetEmployeeId: employeeId,
      eventType: 'ALL_SESSIONS_REVOKED',
      reason: reason ?? null,
      newValue: { revokedCount: count },
      ipAddress: req.ip ?? null,
    });
    return { revoked: count };
  }
}
