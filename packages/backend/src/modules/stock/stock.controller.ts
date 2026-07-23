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

  @Post(':productId/adjust')
  @Roles('admin', 'manager')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Adjust stock quantity manually (admin: any store)' })
  async adjust(
    @Param('productId') productId: string,
    @Body() dto: AdjustStockDto,
    @Request() req: any,
  ) {
    // Même logique générique que products.controller.storeCtxFor : un ADMIN
    // ajuste le stock dans le magasin RÉEL du produit (la page Alertes Stock
    // liste le magasin sélectionné, pas celui du JWT) ; tout autre rôle reste
    // strictement sur son magasin. Audit 2026-07-23 : seul cas à impact réel
    // hors module products.
    const storeId =
      req.user.role === 'admin'
        ? ((await this.stockService.storeIdOfProduct(productId)) ?? req.user.storeId)
        : req.user.storeId;
    return this.stockService.adjustStock(
      productId,
      dto.quantity,
      storeId,
      req.user.employeeId,
      dto.reason,
      dto.mode || 'absolute',
    );
  }
}
