import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoyaltyCardEntity } from '../../database/entities/loyalty-card.entity';
import { CouponEntity } from '../../database/entities/coupon.entity';
import { CustomerEntity } from '../../database/entities/customer.entity';
import { LoyaltyCardController } from './loyalty-card.controller';
import { LoyaltyCardService } from './loyalty-card.service';
import { LoyaltyTokenService } from './loyalty-token.service';
import { CouponModule } from '../coupon/coupon.module';

@Module({
  imports: [
    // CustomerEntity is needed by MobileAuthGuard (used on this module's controller).
    TypeOrmModule.forFeature([LoyaltyCardEntity, CouponEntity, CustomerEntity]),
    CouponModule,
  ],
  controllers: [LoyaltyCardController],
  providers: [LoyaltyCardService, LoyaltyTokenService],
  exports: [LoyaltyCardService, LoyaltyTokenService],
})
export class LoyaltyCardModule {}
