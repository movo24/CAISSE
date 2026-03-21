import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TerminalsService } from './terminals.service';
import { BusinessError } from '../../common/errors/business-error';

@ApiTags('terminals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('terminals')
export class TerminalsController {
  constructor(private readonly terminalsService: TerminalsService) {}

  /**
   * GET /api/terminals
   * List all active terminals for the current store.
   */
  @Get()
  @ApiOperation({ summary: 'List all terminals for the store' })
  async findAll(@Request() req: any) {
    const storeId = req.user?.storeId;
    if (!storeId) {
      throw BusinessError.invalidRelation('Aucun magasin selectionne.');
    }
    return this.terminalsService.findAllByStore(storeId);
  }

  /**
   * POST /api/terminals
   * Create a new terminal for the current store.
   */
  @Post()
  @ApiOperation({ summary: 'Create a new terminal' })
  async create(
    @Request() req: any,
    @Body()
    body: {
      label: string;
      deviceType?: string;
      serialNumber?: string;
      registrationCode?: string;
    },
  ) {
    const storeId = req.user?.storeId;
    if (!storeId) {
      throw BusinessError.invalidRelation('Aucun magasin selectionne.');
    }
    return this.terminalsService.create(storeId, body as any);
  }

  /**
   * PATCH /api/terminals/:id
   * Update a terminal (label, isActive).
   */
  @Patch(':id')
  @ApiOperation({ summary: 'Update a terminal' })
  async update(
    @Param('id') id: string,
    @Body() body: { label?: string; isActive?: boolean },
  ) {
    return this.terminalsService.update(id, body);
  }

  /**
   * POST /api/terminals/:id/heartbeat
   * Update terminal status (heartbeat).
   */
  @Post(':id/heartbeat')
  @ApiOperation({ summary: 'Terminal heartbeat / status update' })
  async heartbeat(
    @Param('id') id: string,
    @Body()
    body: {
      status: string;
      batteryLevel?: number;
      firmwareVersion?: string;
    },
  ) {
    return this.terminalsService.heartbeat(id, body as any);
  }
}
