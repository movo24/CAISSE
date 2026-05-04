import {
  Controller,
  Get,
  Post,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { MobileAuthGuard } from '../../common/guards/mobile-auth.guard';
import { LoyaltyCardService } from './loyalty-card.service';
import { CouponService } from '../coupon/coupon.service';

@ApiTags('mobile/loyalty')
@ApiBearerAuth()
@UseGuards(MobileAuthGuard)
@Controller('mobile')
export class LoyaltyCardController {
  constructor(
    private readonly cardService: LoyaltyCardService,
    private readonly couponService: CouponService,
  ) {}

  @Get('loyalty-card')
  @ApiOperation({
    summary:
      'Get loyalty card view: public code, fresh QR token (60s TTL), next reward eligibility',
  })
  async getCard(@Request() req: any) {
    const customerId = req.customer.id;
    const card = await this.cardService.getCardView(customerId);
    const nextReward = await this.couponService.calculateNextReward(customerId);
    const activeCoupon = await this.couponService.findActiveCoupon(customerId);

    return {
      ...card,
      activeCoupon: activeCoupon
        ? {
            id: activeCoupon.id,
            type: activeCoupon.type,
            discountPercent: activeCoupon.discountValue,
            validUntil: activeCoupon.validUntil?.toISOString() ?? null,
          }
        : null,
      nextReward,
    };
  }

  @Post('loyalty-card/regenerate-qr')
  @ApiOperation({ summary: 'Rotate QR secret — invalidates all previous tokens' })
  async rotate(@Request() req: any) {
    return this.cardService.rotateQr(req.customer.id);
  }
}
