import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  Headers,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { LoyaltyCardService } from '../loyalty-card/loyalty-card.service';
import { CouponService } from '../coupon/coupon.service';
import { CustomerVisitsService } from '../customer-visits/customer-visits.service';

@ApiTags('pos/loyalty')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard) // employee JWT
@Controller('pos/loyalty')
export class PosLoyaltyController {
  constructor(
    private readonly cardService: LoyaltyCardService,
    private readonly couponService: CouponService,
    private readonly visitsService: CustomerVisitsService,
  ) {}

  /** Scan QR — read-only resolution + display. */
  @Post('scan')
  @Throttle({ default: { ttl: 60000, limit: 20 } }) // 20/min/terminal
  @ApiOperation({
    summary: 'Resolve QR token, return customer info + available coupon',
  })
  async scan(
    @Body()
    body: { qrToken: string; storeId: string; terminalId: string; ticketDraftId?: string },
  ) {
    if (!body.qrToken) throw new BadRequestException('qrToken requis');
    const card = await this.cardService.resolveToken(body.qrToken);
    return this.couponService.scanForPos(card.customerId);
  }

  /** Redeem coupon — TRANSACTIONAL, idempotent. */
  @Post('redeem')
  @Throttle({ default: { ttl: 60000, limit: 10 } }) // 10/min/terminal
  @ApiOperation({
    summary:
      'Redeem coupon (transactional, idempotent via X-Idempotency-Key header)',
  })
  async redeem(
    @Request() req: any,
    @Headers('x-idempotency-key') idempotencyKey: string,
    @Body()
    body: {
      customerId: string;
      couponId: string;
      storeId: string;
      terminalId?: string;
      ticketId: string;
      ticketAmountCents: number;
    },
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('Header X-Idempotency-Key requis');
    }
    return this.couponService.redeem(
      {
        ...body,
        cashierEmployeeId: req.user?.employeeId,
      },
      idempotencyKey,
    );
  }

  /** Record a visit without coupon redemption (e.g. just a scan for tracking). */
  @Post('visit')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @ApiOperation({ summary: 'Record a customer visit (no coupon redeemed)' })
  async visit(
    @Request() req: any,
    @Body()
    body: {
      customerId: string;
      storeId: string;
      terminalId?: string;
      ticketId?: string;
      purchaseAmountCents?: number;
    },
  ) {
    return this.visitsService.recordVisit({
      ...body,
      cashierEmployeeId: req.user?.employeeId,
    });
  }
}
