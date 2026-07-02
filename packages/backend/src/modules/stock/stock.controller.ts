import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { StockService } from './stock.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { AdjustStockDto, UpdateThresholdsDto } from '../../common/dto';

@ApiTags('stock')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('stock')
export class StockController {
  constructor(private stockService: StockService) {}

  @Get('alerts')
  @ApiOperation({ summary: 'Get stock alerts (low + critical)' })
  getAlerts(@Request() req: any) {
    return this.stockService.getAlerts(req.user.storeId);
  }

  @Get('reconcile')
  @Roles('admin', 'manager')
  @UseGuards(RolesGuard)
  @ApiOperation({
    summary:
      'P308 — read-only reconciliation: products counter vs movement-journal net vs legacy stock_balances (supervision; no write)',
  })
  reconcile(@Request() req: any) {
    return this.stockService.reconcile(req.user.storeId);
  }

  @Put('default-thresholds')
  @Roles('admin', 'manager')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Update default stock thresholds for all products in store' })
  updateDefaultThresholds(
    @Body() dto: UpdateThresholdsDto,
    @Request() req: any,
  ) {
    return this.stockService.updateDefaultThresholds(
      req.user.storeId,
      dto.alertThreshold,
      dto.criticalThreshold,
    );
  }

  @Post('variance')
  @Roles('admin', 'manager')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'POS-152 — inventory variance report (system vs counted, cost-valued). Read-only; no stock change.' })
  variance(
    @Body() dto: { counts: { productId?: string; ean?: string; countedQty: number }[] },
    @Request() req: any,
  ) {
    return this.stockService.computeVariance(req.user.storeId, dto?.counts ?? []);
  }

  @Post(':productId/adjust')
  @Roles('admin', 'manager')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Adjust stock quantity manually' })
  adjust(
    @Param('productId') productId: string,
    @Body() dto: AdjustStockDto,
    @Request() req: any,
  ) {
    return this.stockService.adjustStock(
      productId,
      dto.quantity,
      req.user.storeId,
      req.user.employeeId,
      dto.reason,
      dto.mode || 'absolute',
    );
  }
}
