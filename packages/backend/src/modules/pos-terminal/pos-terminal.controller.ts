import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Request,
  UseGuards,
  BadRequestException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { PosTerminalService } from './pos-terminal.service';
import { ProvisionTerminalDto } from './dto/provision-terminal.dto';
import { UpdateTerminalDto } from './dto/update-terminal.dto';

/**
 * POS terminal registry — (1b) first brick.
 *
 * Provisioning is a privileged op (admin/manager, mirroring the Stripe
 * terminals controller). The store always comes from the JWT — a manager
 * provisions only for their own store, never via a body-supplied storeId.
 */
@ApiTags('pos-terminals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('pos-terminals')
export class PosTerminalController {
  constructor(private readonly service: PosTerminalService) {}

  @Get()
  @ApiOperation({ summary: 'List active POS terminals for the current store.' })
  findAll(@Request() req: any) {
    const storeId = req.user?.storeId;
    if (!storeId) throw new BadRequestException('No store selected');
    return this.service.findAllByStore(storeId);
  }

  @Post()
  @Roles('admin', 'manager')
  @ApiOperation({
    summary: 'Provision a logical POS till for the current store (privileged).',
  })
  provision(@Body() dto: ProvisionTerminalDto, @Request() req: any) {
    const storeId = req.user?.storeId;
    if (!storeId) throw new BadRequestException('No store selected');
    return this.service.provision(storeId, dto.terminalCode, dto.label);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @ApiOperation({
    summary: 'Update a POS till (label / soft-deactivate). Privileged.',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTerminalDto,
    @Request() req: any,
  ) {
    const storeId = req.user?.storeId;
    if (!storeId) throw new BadRequestException('No store selected');
    return this.service.update(id, storeId, dto);
  }
}
