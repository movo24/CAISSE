import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Headers,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { hasMinRole } from '../../common/guards/permissions';
import { EmployeeScoreService, ScorePeriod } from './employee-score.service';
import { LogScoreEventDto, RecomputeScoreDto } from './dto/log-score-event.dto';

@ApiTags('employee-score')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('employee-score')
export class EmployeeScoreController {
  constructor(private service: EmployeeScoreService) {}

  /**
   * Journalise un fait POS probant. Un caissier ne peut logger que POUR
   * lui-même (targetEmployeeId ignoré) ; un manager/admin peut cibler un
   * employé de son magasin. employeeId/storeId viennent du JWT.
   */
  @Post('events')
  @ApiOperation({ summary: 'Journalise un événement de score (signé employé + terminal + session)' })
  logEvent(
    @Body() dto: LogScoreEventDto,
    @Request() req: any,
    @Headers('x-terminal-id') terminalHeader?: string,
  ) {
    const isManager = hasMinRole(req.user.role, 'manager');
    const employeeId = isManager && dto.targetEmployeeId ? dto.targetEmployeeId : req.user.employeeId;
    return this.service.logEvent({
      employeeId,
      storeId: req.user.storeId,
      eventType: dto.eventType,
      terminalId: dto.terminalId ?? terminalHeader ?? null,
      sessionId: dto.sessionId ?? null,
      reason: dto.reason ?? null,
      metadata: dto.metadata ?? null,
      createdBy: req.user.employeeId,
      source: 'pos',
    });
  }

  /** Score de l'employé connecté (jour + semaine + année) — pour l'affichage caisse. */
  @Get('me')
  @ApiOperation({ summary: 'Score jour/semaine/année de l’employé connecté' })
  myScore(@Request() req: any) {
    return this.service.getScoreSummary(req.user.employeeId);
  }

  @Get('me/detail')
  @ApiOperation({ summary: 'Détail du score du jour + événements récents (connecté)' })
  myDetail(@Request() req: any) {
    return this.service.getDetail(req.user.employeeId);
  }

  /** Score d'un employé donné (manager/admin, même magasin). */
  @Get('employee/:employeeId')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Score d’un employé (période day|week|year)' })
  employeeScore(
    @Param('employeeId') employeeId: string,
    @Query('period') period: ScorePeriod = 'day',
  ) {
    return this.service.getScore(employeeId, period);
  }

  @Get('employee/:employeeId/detail')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Détail du score d’un employé' })
  employeeDetail(@Param('employeeId') employeeId: string) {
    return this.service.getDetail(employeeId);
  }

  /** File d'alertes manager (faits importants récents du magasin). */
  @Get('alerts')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Alertes manager (faits importants récents)' })
  alerts(@Request() req: any, @Query('sinceHours') sinceHours?: string) {
    return this.service.getAlerts(req.user.storeId, sinceHours ? parseInt(sinceHours, 10) : 72);
  }

  /** Recompute manuel d'une date (admin) — le cron nocturne le fait automatiquement. */
  @Post('recompute')
  @Roles('admin')
  @ApiOperation({ summary: 'Recalcule les agrégats journaliers pour une date' })
  async recompute(@Body() dto: RecomputeScoreDto, @Request() req: any) {
    if (!hasMinRole(req.user.role, 'admin')) {
      throw new ForbiddenException('Réservé aux administrateurs.');
    }
    const count = await this.service.recomputeAllForDate(dto.scoreDate);
    return { recomputed: count, scoreDate: dto.scoreDate };
  }
}
