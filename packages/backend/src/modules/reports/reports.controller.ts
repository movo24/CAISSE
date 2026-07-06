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

  @Get('x-report')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Intra-day X-report snapshot (read-only, non-sealing, repeatable)' })
  getXReport(@Request() req: any, @Query('date') date?: string) {
    const effectiveDate = date || new Date().toISOString().split('T')[0];
    return this.reportsService.generateXReport(req.user.storeId, effectiveDate);
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

  @Get('summary')
  @Roles('admin', 'manager')
  @ApiOperation({
    summary:
      'Period analytics summary over an inclusive date range (read-only, sales-derived). ' +
      'Does not replace the daily Z-report. Single day works too.',
  })
  async getPeriodSummary(
    @Request() req: any,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('storeId') queryStoreId?: string,
  ) {
    const effectiveStoreId =
      req.user.role === 'admin' && queryStoreId ? queryStoreId : req.user.storeId;
    return this.reportsService.getPeriodSummary(effectiveStoreId, startDate, endDate);
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

  @Get('sales-trend')
  @Roles('admin', 'manager')
  @ApiOperation({
    summary: 'CA comparisons (J-1/S-1/M-1/N-1) + simple next-day forecast (read-only, sales-derived)',
  })
  async getSalesTrend(@Request() req: any, @Query('storeId') queryStoreId?: string) {
    const effectiveStoreId =
      req.user.role === 'admin' && queryStoreId ? queryStoreId : req.user.storeId;
    return this.productAnalytics.getSalesTrend(effectiveStoreId);
  }
}
