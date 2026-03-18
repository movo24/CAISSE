import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { SkipTenantCheck } from '../../common/interceptors/tenant.interceptor';
import { LivePerformanceService } from './live-performance.service';

@ApiTags('live-performance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('live-performance')
export class LivePerformanceController {
  constructor(private readonly service: LivePerformanceService) {}

  @Get('network')
  @Roles('admin', 'manager')
  @SkipTenantCheck()
  @ApiOperation({ summary: 'Full network snapshot — all stores in the same network' })
  getNetworkSnapshot(@Request() req: any) {
    return this.service.getNetworkSnapshot(req.user.storeId);
  }

  @Get('compact')
  @Roles('admin', 'manager', 'cashier')
  @SkipTenantCheck()
  @ApiOperation({ summary: 'Compact comparison — rank, delta vs leader, alerts' })
  getCompactComparison(@Request() req: any) {
    return this.service.getCompactComparison(req.user.storeId);
  }

  @Get('insight')
  @Roles('admin', 'manager')
  @SkipTenantCheck()
  @ApiOperation({ summary: 'AI-powered positive insight and recommendations' })
  getAiInsight(@Request() req: any) {
    return this.service.getAiInsight(req.user.storeId);
  }
}
