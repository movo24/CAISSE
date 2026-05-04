import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoyaltyRewardCycleEntity } from '../../database/entities/loyalty-reward-cycle.entity';
import { CouponEntity } from '../../database/entities/coupon.entity';
import { CustomerEntity } from '../../database/entities/customer.entity';
import { CustomerVisitEntity } from '../../database/entities/customer-visit.entity';
import { LoyaltyAdminController } from './loyalty-admin.controller';
import { CouponModule } from '../coupon/coupon.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      LoyaltyRewardCycleEntity,
      CouponEntity,
      CustomerEntity,
      CustomerVisitEntity,
    ]),
    CouponModule,
  ],
  controllers: [LoyaltyAdminController],
})
export class LoyaltyAdminModule {}
