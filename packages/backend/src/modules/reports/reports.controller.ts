import {
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { ProductAnalyticsService } from './product-analytics.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('reports')
export class ReportsController {
  constructor(
    private reportsService: ReportsService,
    private productAnalytics: ProductAnalyticsService,
  ) {}

  @Post('z-report')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Generate Z-report for a specific date' })
  generateZReport(@Request() req: any, @Query('date') date: string) {
    return this.reportsService.generateZReport(
      req.user.storeId,
      date,
      req.user.employeeId,
    );
  }

  @Get('z-report')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Get Z-report for a specific date' })
  getZReport(@Request() req: any, @Query('date') date: string) {
    return this.reportsService.getZReport(req.user.storeId, date);
  }

  @Get('daily-summary')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Get daily summaries for a date range' })
  getDailySummary(
    @Request() req: any,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.reportsService.getDailySummary(
      req.user.storeId,
      startDate,
      endDate,
    );
  }

  @Get('store-kpi')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Get store KPIs for a specific date (admin can query any store)' })
  async getStoreKpi(
    @Request() req: any,
    @Query('storeId') queryStoreId?: string,
    @Query('date') date?: string,
  ) {
    const effectiveStoreId = (req.user.role === 'admin' && queryStoreId)
      ? queryStoreId
      : req.user.storeId;
    const effectiveDate = date || new Date().toISOString().split('T')[0];
    return this.reportsService.getStoreKpi(effectiveStoreId, effectiveDate);
  }

  @Get('product-analytics')
  @Roles('admin', 'manager')
  @ApiOperation({
    summary: 'Top / flop / dormant products + stockout & reorder suggestions (read-only, sales-derived)',
  })
  async getProductAnalytics(@Request() req: any, @Query('storeId') queryStoreId?: string) {
    const effectiveStoreId =
      req.user.role === 'admin' && queryStoreId ? queryStoreId : req.user.storeId;
    return this.productAnalytics.getReport(effectiveStoreId);
  }
}
