import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerEntity } from '../../database/entities/customer.entity';
import { MobileAuthController } from './mobile-auth.controller';
import { MobileAuthService } from './mobile-auth.service';
import { LoyaltyCardModule } from '../loyalty-card/loyalty-card.module';
import { CouponModule } from '../coupon/coupon.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CustomerEntity]),
    LoyaltyCardModule,
    CouponModule,
  ],
  controllers: [MobileAuthController],
  providers: [MobileAuthService],
  exports: [MobileAuthService],
})
export class MobileAuthModule {}
