import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CouponEntity } from '../../database/entities/coupon.entity';
import { CustomerVisitEntity } from '../../database/entities/customer-visit.entity';
import { LoyaltyRewardCycleEntity } from '../../database/entities/loyalty-reward-cycle.entity';
import { IdempotencyKeyEntity } from '../../database/entities/idempotency-key.entity';
import { CustomerEntity } from '../../database/entities/customer.entity';
import { CouponController } from './coupon.controller';
import { CouponService } from './coupon.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CouponEntity,
      CustomerVisitEntity,
      LoyaltyRewardCycleEntity,
      IdempotencyKeyEntity,
      CustomerEntity,
    ]),
    AuditModule,
  ],
  controllers: [CouponController],
  providers: [CouponService],
  exports: [CouponService],
})
export class CouponModule {}
