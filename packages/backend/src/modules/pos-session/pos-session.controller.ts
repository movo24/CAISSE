import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Request,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

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
  @ApiOperation({
    summary:
      'Open a POS session for the authenticated employee. Refuses if an active session already exists for this (store, employee).',
  })
  open(@Body() dto: OpenSessionDto, @Request() req: any) {
    return this.service.openSession(
      req.user.storeId,
      req.user.employeeId,
      {
        employeeName: req.user.employeeName,
        employeeRole: req.user.role,
        maxDiscount: req.user.maxDiscount,
      },
      {
        terminalId: dto.terminalId,
        offlineMode: dto.offlineMode,
      },
    );
  }

  @Post(':id/close')
  @ApiOperation({
    summary: 'Close an active POS session. Only the owning employee can close their session.',
  })
  close(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.service.closeSession(
      id,
      req.user.storeId,
      req.user.employeeId,
    );
  }

  @Get('active')
  @ApiOperation({
    summary: 'Get the active POS session for the authenticated employee, if any.',
  })
  active(@Request() req: any) {
    return this.service.findActive(req.user.storeId, req.user.employeeId);
  }
}
