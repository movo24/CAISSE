import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Headers,
  Request,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiHeader } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { PosSessionService } from './pos-session.service';
import { OpenSessionDto } from './dto/open-session.dto';
import { CloseSessionDto } from './dto/close-session.dto';
import { SetOpeningCashDto } from './dto/set-opening-cash.dto';

@ApiTags('pos-sessions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('pos-sessions')
export class PosSessionController {
  constructor(private readonly service: PosSessionService) {}

  @Post('open')
  @ApiHeader({
    name: 'X-Terminal-Id',
    description: 'Physical terminal identifier — required (γ-model: sessions are terminal-bound)',
    required: true,
  })
  @ApiOperation({
    summary:
      'Open a POS session on a terminal. Refuses without X-Terminal-Id, or if the terminal already has an active session.',
  })
  open(
    @Body() dto: OpenSessionDto,
    @Headers('x-terminal-id') terminalId: string,
    @Request() req: any,
  ) {
    return this.service.openSession(
      req.user.storeId,
      req.user.employeeId,
      {
        employeeName: req.user.employeeName,
        employeeRole: req.user.role,
        maxDiscount: req.user.maxDiscount,
      },
      {
        terminalId,
        offlineMode: dto.offlineMode,
        openingCashMinorUnits: dto.openingCashMinorUnits,
      },
    );
  }

  @Post(':id/close')
  @ApiOperation({
    summary:
      'Close an active POS session. Only the owning employee can close their session. ' +
      'Optionally send countedCashMinorUnits to record the cash count + écart (attendu serveur vs compté).',
  })
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: CloseSessionDto,
  ) {
    return this.service.closeSession(
      id,
      req.user.storeId,
      req.user.employeeId,
      { countedCashMinorUnits: dto?.countedCashMinorUnits, skipReason: dto?.skipReason },
    );
  }

  @Post(':id/opening-cash')
  @ApiOperation({
    summary:
      'Declare (cashier, once) or correct (manager/admin, audited) the opening cash float of a session. ' +
      'Saisi à l\'ouverture, immuable ensuite ; toute correction laisse une trace.',
  })
  setOpeningCash(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: SetOpeningCashDto,
  ) {
    return this.service.setOpeningCash(
      id,
      req.user.storeId,
      req.user.employeeId,
      req.user.role,
      dto.openingCashMinorUnits,
    );
  }

  @Get()
  @Roles('admin', 'manager')
  @UseGuards(RolesGuard)
  @ApiOperation({
    summary:
      'List recent POS sessions for the store (manager/admin). Source probante des écarts caisse : ' +
      'employé, terminal, horodatages, comptage (attendu/compté/écart dérivés serveur).',
  })
  list(
    @Request() req: any,
    @Query('limit') limit?: string,
    @Query('activeOnly') activeOnly?: string,
    @Query('withCashCountOnly') withCashCountOnly?: string,
    @Query('storeId') queryStoreId?: string,
  ) {
    // Admin peut cibler un magasin via ?storeId= ; sinon magasin du JWT.
    const storeId = req.user.role === 'admin' && queryStoreId ? queryStoreId : req.user.storeId;
    return this.service.listSessions(storeId, {
      limit: limit ? parseInt(limit, 10) : undefined,
      activeOnly: activeOnly === 'true',
      withCashCountOnly: withCashCountOnly === 'true',
    });
  }

  @Get('off-session')
  @Roles('admin', 'manager')
  @UseGuards(RolesGuard)
  @ApiOperation({
    summary:
      "Ventes HORS SESSION des N derniers jours (manager/admin, lecture seule) : " +
      "argent encaissé sans session, donc hors de tout comptage de caisse — rendu visible.",
  })
  offSession(
    @Request() req: any,
    @Query('days') days?: string,
    @Query('storeId') queryStoreId?: string,
  ) {
    // Même règle de ciblage que list() : admin peut viser un magasin, sinon JWT.
    const storeId = req.user.role === 'admin' && queryStoreId ? queryStoreId : req.user.storeId;
    return this.service.listOffSessionCash(storeId, days ? parseInt(days, 10) : undefined);
  }

  @Get('active')
  @ApiHeader({
    name: 'X-Terminal-Id',
    description: 'Physical terminal identifier — required',
    required: true,
  })
  @ApiOperation({
    summary: 'Get the active POS session for this terminal, if any (γ-model lookup).',
  })
  active(
    @Headers('x-terminal-id') terminalId: string,
    @Request() req: any,
  ) {
    return this.service.findActiveForTerminal(req.user.storeId, terminalId);
  }
}
