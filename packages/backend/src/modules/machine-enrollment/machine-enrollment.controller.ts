import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { MachineEnrollmentService } from './machine-enrollment.service';
import {
  RequestEnrollmentDto,
  RejectEnrollmentDto,
  RevokeEnrollmentDto,
} from './dto/machine-enrollment.dto';
import { PosMachineStatus } from '../../database/entities/pos-machine.entity';

/**
 * Enrôlement machine POS (Partie B).
 *
 * - La caisse (rôle cashier) déclare son identité (`POST request`) et interroge
 *   son statut (`GET status`).
 * - Le back-office (manager/admin) liste les machines et valide / rejette /
 *   révoque.
 *
 * Le magasin provient toujours du JWT (tenant) — jamais du corps de requête.
 */
@ApiTags('machine-enrollment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('pos/enrollment')
export class MachineEnrollmentController {
  constructor(private readonly service: MachineEnrollmentService) {}

  @Post('request')
  @ApiOperation({ summary: "Déclare l'identité d'une machine (crée/rafraîchit une demande)" })
  requestEnrollment(@Body() dto: RequestEnrollmentDto, @Request() req: any) {
    return this.service.requestEnrollment(
      req.user.storeId,
      dto,
      req.user.employeeId ?? null,
    );
  }

  @Get('status')
  @ApiOperation({ summary: "Statut d'enrôlement d'une machine (polling caisse)" })
  async status(@Query('machineId') machineId: string) {
    const m = machineId ? await this.service.getByMachineId(machineId) : null;
    if (!m) return { enrolled: false, status: null };
    return {
      enrolled: m.status === 'approved',
      status: m.status,
      storeId: m.storeId,
      terminalLabel: m.terminalLabel,
      decidedAt: m.decidedAt,
      decisionReason: m.decisionReason,
    };
  }

  @Get()
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Liste les machines du magasin (optionnellement par statut)' })
  list(@Request() req: any, @Query('status') status?: PosMachineStatus) {
    return this.service.listByStore(req.user.storeId, status);
  }

  @Post(':id/approve')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Approuve une machine (autorisée à vendre)' })
  approve(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.service.approve(id, req.user.employeeId);
  }

  @Post(':id/reject')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Rejette une demande (motif journalisé)' })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectEnrollmentDto,
    @Request() req: any,
  ) {
    return this.service.reject(id, req.user.employeeId, dto.reason);
  }

  @Post(':id/revoke')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Révoque une machine approuvée (motif journalisé)' })
  revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RevokeEnrollmentDto,
    @Request() req: any,
  ) {
    return this.service.revoke(id, req.user.employeeId, dto.reason);
  }
}
