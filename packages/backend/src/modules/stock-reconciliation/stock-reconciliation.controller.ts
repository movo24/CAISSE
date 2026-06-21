import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { StockReconciliationService } from './stock-reconciliation.service';

@ApiTags('stock-reconciliation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('stock-reconciliation')
export class StockReconciliationController {
  constructor(private readonly service: StockReconciliationService) {}

  @Post('count')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Submit a physical count; ≥20% shortage flags a variance for review' })
  count(@Body() body: { productId: string; physicalQty: number }, @Request() req: any) {
    return this.service.submitCount(req.user.storeId, body.productId, body.physicalQty, req.user.employeeId);
  }

  @Get('pending')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'List stock variances awaiting a manager decision' })
  pending(@Request() req: any) {
    return this.service.listPending(req.user.storeId);
  }

  @Post(':id/confirm')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Confirm a variance correction (mandatory reason) — applies the count' })
  confirm(
    @Param('id') id: string,
    @Body() body: { confirmedQty: number; reason: string },
    @Request() req: any,
  ) {
    return this.service.confirmCorrection(id, req.user.storeId, body.confirmedQty, body.reason, req.user.employeeId);
  }

  @Post(':id/reject')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Reject a variance (recount matched; no stock change)' })
  reject(@Param('id') id: string, @Body() body: { note?: string }, @Request() req: any) {
    return this.service.reject(id, req.user.storeId, req.user.employeeId, body?.note);
  }
}
