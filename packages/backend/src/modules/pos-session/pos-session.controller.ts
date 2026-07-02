import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Headers,
  Request,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiHeader } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PosSessionService } from './pos-session.service';
import { OpenSessionDto } from './dto/open-session.dto';

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
        openingFloatMinorUnits: dto.openingFloatMinorUnits ?? null, // P351
      },
    );
  }

  @Post(':id/close')
  @ApiOperation({
    summary:
      'Close an active POS session. Only the owning employee can close their session. ' +
      'P351: optional countedCashMinorUnits — server computes and freezes the signed cash variance.',
  })
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { countedCashMinorUnits?: number | null } | undefined,
    @Request() req: any,
  ) {
    return this.service.closeSession(
      id,
      req.user.storeId,
      req.user.employeeId,
      { countedCashMinorUnits: body?.countedCashMinorUnits ?? null },
    );
  }

  @Get(':id/cash-summary')
  @ApiOperation({
    summary:
      'P312 — cash summary of a session for the till count (completed sales stamped pos_session_id; cash + total captured). Read-only.',
  })
  cashSummary(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.service.getSessionCashSummary(id, req.user.storeId);
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
