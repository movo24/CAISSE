import {
  Controller,
  Get,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { MobileAuthGuard } from '../../common/guards/mobile-auth.guard';
import { CouponService } from './coupon.service';

@ApiTags('mobile/coupons')
@ApiBearerAuth()
@UseGuards(MobileAuthGuard)
@Controller('mobile/coupons')
export class CouponController {
  constructor(private readonly couponService: CouponService) {}

  @Get()
  @ApiOperation({ summary: 'List coupons (history). ?status=AVAILABLE|USED|ALL' })
  async list(
    @Request() req: any,
    @Query('status') status?: 'AVAILABLE' | 'USED' | 'ALL',
  ) {
    const coupons = await this.couponService.listForCustomer(
      req.customer.id,
      status ?? 'ALL',
    );
    return coupons.map((c) => ({
      id: c.id,
      type: c.type,
      discountPercent: c.discountValue,
      status: c.status,
      validFrom: c.validFrom.toISOString(),
      validUntil: c.validUntil?.toISOString() ?? null,
      usedAt: c.usedAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
    }));
  }

  @Get('active')
  @ApiOperation({ summary: 'Get the currently active coupon (or null)' })
  async active(@Request() req: any) {
    const c = await this.couponService.findActiveCoupon(req.customer.id);
    if (!c) return null;
    return {
      id: c.id,
      type: c.type,
      discountPercent: c.discountValue,
      validUntil: c.validUntil?.toISOString() ?? null,
    };
  }

  @Get('history')
  @ApiOperation({ summary: 'List used + expired coupons' })
  async history(@Request() req: any) {
    const all = await this.couponService.listForCustomer(req.customer.id, 'ALL');
    return all
      .filter((c) => c.status !== 'AVAILABLE')
      .map((c) => ({
        id: c.id,
        type: c.type,
        discountPercent: c.discountValue,
        status: c.status,
        usedAt: c.usedAt?.toISOString() ?? null,
        createdAt: c.createdAt.toISOString(),
      }));
  }
}
