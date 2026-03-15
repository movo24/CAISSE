import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JackpotService } from './jackpot.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { CreateJackpotConfigDto, UpdateJackpotConfigDto } from '../../common/dto';

@ApiTags('jackpot')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('jackpot')
export class JackpotController {
  constructor(private readonly jackpotService: JackpotService) {}

  /**
   * GET /api/jackpot/:storeId/config
   * Returns the jackpot configuration for the store. Any role can read.
   */
  @Get(':storeId/config')
  @ApiOperation({ summary: 'Get jackpot config for store' })
  getConfig(@Param('storeId') storeId: string, @Request() req: any) {
    // Tenant check
    if (storeId !== req.user.storeId) {
      return this.jackpotService.getConfig(req.user.storeId);
    }
    return this.jackpotService.getConfig(storeId);
  }

  /**
   * POST /api/jackpot/:storeId/config
   * Create initial jackpot config. Admin only.
   */
  @Post(':storeId/config')
  @Roles('admin')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Create jackpot config (admin only — HQ control)' })
  createConfig(
    @Param('storeId') storeId: string,
    @Body() dto: CreateJackpotConfigDto,
    @Request() req: any,
  ) {
    return this.jackpotService.createConfig(req.user.storeId, dto);
  }

  /**
   * PUT /api/jackpot/:storeId/config
   * Update quotas, thresholds, media URLs. Admin only.
   * This is the "HQ control panel" — local POS cannot call this.
   */
  @Put(':storeId/config')
  @Roles('admin')
  @UseGuards(RolesGuard)
  @ApiOperation({
    summary: 'Update jackpot config (admin only — quotas, media, thresholds)',
  })
  updateConfig(
    @Param('storeId') storeId: string,
    @Body() dto: UpdateJackpotConfigDto,
    @Request() req: any,
  ) {
    return this.jackpotService.updateConfig(req.user.storeId, dto);
  }

  /**
   * GET /api/jackpot/:storeId/status
   * Live status: quotas remaining, current density, mega eligibility.
   */
  @Get(':storeId/status')
  @ApiOperation({
    summary: 'Get jackpot status (quotas remaining, density, eligibility)',
  })
  getStatus(@Param('storeId') storeId: string, @Request() req: any) {
    return this.jackpotService.getStatus(req.user.storeId);
  }

  /**
   * GET /api/jackpot/:storeId/history
   * Win history for the store.
   */
  @Get(':storeId/history')
  @Roles('admin', 'manager')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Get jackpot win history' })
  getHistory(
    @Param('storeId') storeId: string,
    @Query('limit') limit?: string,
    @Request() req?: any,
  ) {
    return this.jackpotService.getWinHistory(
      req.user.storeId,
      limit ? parseInt(limit) : 50,
    );
  }
}
