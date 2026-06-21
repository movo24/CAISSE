import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { PromoCodesService } from './promo-codes.service';

@ApiTags('promo-codes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('promo-codes')
export class PromoCodesController {
  constructor(private readonly service: PromoCodesService) {}

  @Post()
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Create a promo code' })
  create(@Body() body: any, @Request() req: any) {
    return this.service.create(req.user.storeId, {
      ...body,
      startsAt: body?.startsAt ? new Date(body.startsAt) : null,
      endsAt: body?.endsAt ? new Date(body.endsAt) : null,
    });
  }

  @Get()
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'List promo codes' })
  list(@Request() req: any) {
    return this.service.list(req.user.storeId);
  }

  @Post('validate')
  @ApiOperation({ summary: 'Validate a promo code (no state change)' })
  validate(@Body() body: { code: string; productId?: string; categoryId?: string }, @Request() req: any) {
    return this.service.validate(body?.code ?? '', req.user.storeId, { productId: body?.productId, categoryId: body?.categoryId });
  }

  @Post('redeem')
  @ApiOperation({ summary: 'Redeem a promo code (usage cap enforced; applier audited)' })
  redeem(
    @Body() body: { code: string; saleId?: string; discountAppliedMinorUnits?: number; productId?: string; categoryId?: string },
    @Request() req: any,
  ) {
    return this.service.redeem(body?.code ?? '', req.user.storeId, req.user.employeeId, {
      saleId: body?.saleId,
      discountAppliedMinorUnits: body?.discountAppliedMinorUnits,
      productId: body?.productId,
      categoryId: body?.categoryId,
    });
  }

  @Post(':id/deactivate')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Deactivate a promo code' })
  deactivate(@Param('id') id: string, @Request() req: any) {
    return this.service.deactivate(id, req.user.storeId);
  }

  @Get(':id/history')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Usage history of a promo code' })
  history(@Param('id') id: string, @Request() req: any) {
    return this.service.history(id, req.user.storeId);
  }
}
