import { Body, Controller, Get, Param, Patch, Query, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { StockAnomaliesService } from './stock-anomalies.service';

/**
 * Anomalies de stock (chantier 4) — visibles par le responsable du magasin et
 * par le Central (admin : `?storeId=` pour cibler un magasin ; le
 * TenantInterceptor global bloque déjà tout storeId ≠ JWT pour les non-admins).
 */
@ApiTags('stock-anomalies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('stock-anomalies')
export class StockAnomaliesController {
  constructor(private readonly service: StockAnomaliesService) {}

  @Get()
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'List stock anomalies (sales allowed despite unavailability)' })
  list(
    @Request() req: any,
    @Query('status') status?: 'a_controler' | 'controlee',
    @Query('storeId') storeId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const effectiveStoreId =
      req.user.role === 'admin' && storeId ? storeId : req.user.storeId;
    return this.service.list(effectiveStoreId, {
      status: status === 'a_controler' || status === 'controlee' ? status : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get('pending-count')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Count of anomalies with status À contrôler (notification badge)' })
  async pendingCount(@Request() req: any, @Query('storeId') storeId?: string) {
    const effectiveStoreId =
      req.user.role === 'admin' && storeId ? storeId : req.user.storeId;
    return { pendingCount: await this.service.countPending(effectiveStoreId) };
  }

  @Patch(':id/control')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Mark an anomaly as controlled (mandatory justification)' })
  control(
    @Param('id') id: string,
    @Body() body: { justification: string; storeId?: string },
    @Request() req: any,
  ) {
    const effectiveStoreId =
      req.user.role === 'admin' && body?.storeId ? body.storeId : req.user.storeId;
    return this.service.markControlled(
      id,
      effectiveStoreId,
      req.user.employeeId,
      req.user.employeeName ?? null,
      body?.justification ?? '',
    );
  }
}
