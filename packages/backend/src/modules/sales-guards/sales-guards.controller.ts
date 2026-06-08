import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Req,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Request } from 'express';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SalesGuardsService } from './sales-guards.service';
import { EvaluateSaleGuardsDto } from './dto/evaluate-sale-guards.dto';
import { ListAnomaliesDto } from './dto/list-anomalies.dto';

type AuthUser = {
  employeeId: string;
  storeId: string;
  role: 'admin' | 'manager' | 'cashier';
};

@ApiTags('sales-guards')
@ApiBearerAuth()
@Controller('sales-guards')
@UseGuards(JwtAuthGuard)
export class SalesGuardsController {
  constructor(private readonly service: SalesGuardsService) {}

  @Get('config')
  @ApiOperation({ summary: 'Get the active guard thresholds' })
  getConfig() {
    return this.service.getConfig();
  }

  @Post('evaluate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Evaluate a cart against the anti-error guards (read-only)' })
  evaluate(@Body() dto: EvaluateSaleGuardsDto, @Req() req: Request & { user: AuthUser }) {
    return this.service.evaluate({
      storeId: req.user.storeId,
      sellerId: req.user.employeeId,
      items: dto.items,
      saleId: dto.saleId,
      freeProductUsageCount: dto.freeProductUsageCount,
      cancellationCount: dto.cancellationCount,
    });
  }

  @Get('anomalies')
  @ApiOperation({ summary: 'List detected anomalies (filterable)' })
  listAnomalies(@Query() dto: ListAnomaliesDto, @Req() req: Request & { user: AuthUser }) {
    // Cashiers are scoped to their own store; managers/admins may pass storeId.
    if (req.user.role === 'cashier') {
      dto.storeId = req.user.storeId;
    }
    return this.service.listAnomalies(dto);
  }

  @Get('anomalies/summary')
  @ApiOperation({ summary: 'Anomaly counts by code/severity for the dashboard' })
  getSummary(
    @Query('storeId') storeId: string | undefined,
    @Query('from') from: string | undefined,
    @Req() req: Request & { user: AuthUser },
  ) {
    const scopedStore = req.user.role === 'cashier' ? req.user.storeId : storeId;
    return this.service.getSummary(scopedStore, from);
  }

  @Post('anomalies/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve an anomaly (manager/admin only)' })
  approve(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request & { user: AuthUser }) {
    this.assertReviewer(req.user.role);
    return this.service.approveAnomaly(id, req.user.employeeId);
  }

  @Post('anomalies/:id/ignore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ignore an anomaly (manager/admin only)' })
  ignore(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request & { user: AuthUser }) {
    this.assertReviewer(req.user.role);
    return this.service.ignoreAnomaly(id, req.user.employeeId);
  }

  private assertReviewer(role: AuthUser['role']): void {
    if (role !== 'manager' && role !== 'admin') {
      throw new ForbiddenException('Seul un manager ou admin peut traiter une anomalie');
    }
  }
}
