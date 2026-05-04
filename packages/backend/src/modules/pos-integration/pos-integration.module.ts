import { Module } from '@nestjs/common';
import { PosLoyaltyController } from './pos-loyalty.controller';
import { LoyaltyCardModule } from '../loyalty-card/loyalty-card.module';
import { CouponModule } from '../coupon/coupon.module';
import { CustomerVisitsModule } from '../customer-visits/customer-visits.module';

@Module({
  imports: [LoyaltyCardModule, CouponModule, CustomerVisitsModule],
  controllers: [PosLoyaltyController],
})
export class PosIntegrationModule {}
